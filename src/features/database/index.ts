import snowflake from 'snowflake-sdk';
import { XMLParser } from 'fast-xml-parser';
import { settings } from '../../utils';

let connection: snowflake.Connection | null = null;
let config: any = null;

async function initDbConnection() {
  if (connection) return connection;

  config = await settings.getSnowflakeConfig();

  if (!config) throw new Error('Snowflake config is missing');

  connection = snowflake.createConnection({
    account: config.account,
    username: config.user,
    password: config.password,
    warehouse: config.warehouse,
    database: config.database,
    schema: config.schema,
    role: config.role,
  });

  return new Promise<snowflake.Connection>((resolve, reject) => {
    connection!.connect((err, conn) => {
      if (err) reject(err);
      else resolve(conn);
    });
  });
}

async function query(conn: snowflake.Connection, sql: string, binds: any[] = []): Promise<any[]> {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      binds,
      complete: (err, stmt, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      },
    });
  });
}

export async function saveParsedTravelFolder(xmlString: string): Promise<boolean> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const json = parser.parse(xmlString);
  const travelFolder = json.DTM_TravelFolder.TravelFolder;

  const enquiry: Enquiry = {
    source_booking_id: travelFolder.SourceBookingID ?? null,
    departure_date: travelFolder.BookingDepartureDate ?? null,
    create_date: travelFolder.SourceBookingCreateDate ?? null,
    STATUS: travelFolder.WorkflowStatus ?? null,
    is_quote_only: travelFolder.IsQuoteOnly === "true" ? 1 : 0,
    destination_name: travelFolder.BookingDestinationName ?? null,
    destination_country: travelFolder.BookingDestinationCountryCode ?? null,
    airport: null,
  };

  const comments = travelFolder.ReservationCommentItems?.ReservationCommentItem;
  let tripDetailsRawText = Array.isArray(comments)
    ? comments.map(c => c.Text).join(" | ")
    : comments?.Text || "";

  const tripDetails: TripDetails = {
    hotel: null,
    nights: null,
    golfers: null,
    non_golfers: null,
    rounds: null,
    adults: null,
    children: null,
    holiday_plans: null,
    budget_from: null,
    budget_to: null,
    airport: null,
  };

  const match = (regex: RegExp) => tripDetailsRawText.match(regex)?.[1]?.trim();
  const toInt = (val: string | undefined) => val ? parseInt(val) : null;
  const toFloat = (val: string | undefined) => val ? parseFloat(val.replace(/,/g, '')) : null;

  tripDetails.hotel = match(/Hotel:\s*([^|]+)/i) || null;
  tripDetails.nights = toInt(match(/Nights:\s*(\d+)/i));
  tripDetails.golfers = toInt(match(/Golfers:\s*(\d+)/i));
  tripDetails.non_golfers = toInt(match(/Non Golfers:\s*(\d*)/i));
  tripDetails.rounds = toInt(match(/Rounds:\s*(\d+)/i));
  tripDetails.adults = toInt(match(/Adults:\s*(\d+)/i));
  tripDetails.children = toInt(match(/Children:\s*(\d+)/i));
  tripDetails.holiday_plans = match(/Holiday Plans:\s*([^|]+)/i) || null;

  const budgetRange = tripDetailsRawText.match(/Budget\s*:\s*£?([\d,]+)pp\s*-\s*£?([\d,]+)pp/i);
  if (budgetRange) {
    tripDetails.budget_from = toFloat(budgetRange[1]);
    tripDetails.budget_to = toFloat(budgetRange[2]);
  }

  const airport = match(/Airport\s*([^|]+)/i);
  if (airport) enquiry.airport = tripDetails.airport = airport;

  const customer = travelFolder.CustomerForBooking?.DirectCustomer?.Customer;
  const customerData: CustomerData = {
    given_name: customer?.PersonName?.GivenName || null,
    surname: customer?.PersonName?.Surname || null,
    email: customer?.Email || null,
    phone_number: customer?.TelephoneInfo?.Telephone?.PhoneNumber || null,
    newsletter_opt_in: customer?.CommunicationPreferences?.Newsletter ? 1 : 0,
  };

  let passengers: Passenger[] = [];
  const rawPassengers = travelFolder.PassengerListItems?.PassengerListItem;
  if (rawPassengers) {
    if (Array.isArray(rawPassengers)) {
      passengers = rawPassengers.map((p: any) => ({
        given_name: p.PersonName?.GivenName || null,
        surname: p.PersonName?.Surname || null,
      }));
    } else {
      passengers.push({
        given_name: rawPassengers.PersonName?.GivenName || null,
        surname: rawPassengers.PersonName?.Surname || null,
      });
    }
  }

  const marketing: Marketing = {
    campaign_code: travelFolder.MarketingCampaignCode ?? null,
    source: travelFolder.EnhancedData01 ?? null,
    medium: travelFolder.EnhancedData02 ?? null,
    ad_id: travelFolder.EnhancedData00 ?? null,
  };

  const conn = await initDbConnection();

  // Check if enquiry exists
  const existing = await query(conn, `SELECT id FROM enquiries WHERE source_booking_id = ? LIMIT 1`, [enquiry.source_booking_id]);
  if (existing.length > 0) {
    console.warn(`Enquiry with source_booking_id ${enquiry.source_booking_id} already exists, skipping.`);
    return false;
  }

  // Insert enquiry
  await query(conn, `
    INSERT INTO enquiries (source_booking_id, departure_date, create_date, STATUS, is_quote_only, destination_name, destination_country, airport)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
    enquiry.source_booking_id,
    enquiry.departure_date,
    enquiry.create_date,
    enquiry.STATUS,
    enquiry.is_quote_only,
    enquiry.destination_name,
    enquiry.destination_country,
    enquiry.airport,
  ]);

  const insertedEnquiry = await query(conn, `SELECT id FROM enquiries WHERE source_booking_id = ?`, [enquiry.source_booking_id]);
  const enquiryId = insertedEnquiry[0].ID;

  // Insert customer
  if (customerData.email) {
    const exists = await query(conn, `SELECT id FROM customers WHERE email = ? LIMIT 1`, [customerData.email]);
    if (exists.length === 0) {
      await query(conn, `
        INSERT INTO customers (enquiry_id, given_name, surname, email, phone_number, newsletter_opt_in)
        VALUES (?, ?, ?, ?, ?, ?)`, [
        enquiryId,
        customerData.given_name,
        customerData.surname,
        customerData.email,
        customerData.phone_number,
        customerData.newsletter_opt_in,
      ]);
    }
  }

  // Insert passengers
  for (const p of passengers) {
    const existing = await query(conn,
      `SELECT id FROM passengers WHERE enquiry_id = ? AND given_name = ? AND surname = ? LIMIT 1`,
      [enquiryId, p.given_name, p.surname]
    );
    if (existing.length === 0) {
      await query(conn, `
        INSERT INTO passengers (enquiry_id, given_name, surname)
        VALUES (?, ?, ?)`, [
        enquiryId, p.given_name, p.surname
      ]);
    }
  }

  // Insert trip_details
  const tripExists = await query(conn, `SELECT id FROM trip_details WHERE enquiry_id = ? LIMIT 1`, [enquiryId]);
  if (tripExists.length === 0) {
    await query(conn, `
      INSERT INTO trip_details (enquiry_id, hotel, nights, golfers, non_golfers, rounds, adults, children, holiday_plans, budget_from, budget_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      enquiryId,
      tripDetails.hotel,
      tripDetails.nights,
      tripDetails.golfers,
      tripDetails.non_golfers,
      tripDetails.rounds,
      tripDetails.adults,
      tripDetails.children,
      tripDetails.holiday_plans,
      tripDetails.budget_from,
      tripDetails.budget_to,
    ]);
  }

  // Insert marketing
  if (marketing.campaign_code || marketing.source || marketing.medium || marketing.ad_id) {
    await query(conn, `
      INSERT INTO marketing (enquiry_id, campaign_code, SOURCE, MEDIUM, ad_id)
      VALUES (?, ?, ?, ?, ?)`, [
      enquiryId,
      marketing.campaign_code,
      marketing.source,
      marketing.medium,
      marketing.ad_id,
    ]);
  }

  return true;
}
