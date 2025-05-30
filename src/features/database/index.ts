import mysql from 'mysql2/promise';
import { ResultSetHeader } from 'mysql2';
import { settings } from '../../utils';
import { XMLParser } from 'fast-xml-parser';

let pool: mysql.Pool | null = null;
let config: any = null;

async function initDbPool() {
  if (pool) return pool;

  config = await settings.getMySqlDatabaseConfig();

  if (!config || !config.user || !config.host || !config.password || !config.database) {
    throw new Error(
      'MySQL Database settings not configured or incomplete. Please set up your database settings.'
    );
  }

  pool = mysql.createPool({
    host: config.host,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  return pool;
}

export async function saveParsedTravelFolder(xmlString: string): Promise<boolean> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
  });
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
  let tripDetailsRawText = "";
  if (Array.isArray(comments)) {
    tripDetailsRawText = comments.map(c => c.Text).join(" | ");
  } else if (comments) {
    tripDetailsRawText = comments.Text;
  }

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

  if (tripDetailsRawText) {
    const matchHotel = tripDetailsRawText.match(/Hotel:\s*([^|]+)/i);
    if (matchHotel) tripDetails.hotel = matchHotel[1].trim();

    const matchNights = tripDetailsRawText.match(/Nights:\s*(\d+)/i);
    if (matchNights) tripDetails.nights = parseInt(matchNights[1]);

    const matchGolfers = tripDetailsRawText.match(/Golfers:\s*(\d+)/i);
    if (matchGolfers) tripDetails.golfers = parseInt(matchGolfers[1]);

    const matchNonGolfers = tripDetailsRawText.match(/Non Golfers:\s*(\d*)/i);
    if (matchNonGolfers && matchNonGolfers[1].trim() !== "") tripDetails.non_golfers = parseInt(matchNonGolfers[1]);

    const matchRounds = tripDetailsRawText.match(/Rounds:\s*(\d+)/i);
    if (matchRounds) tripDetails.rounds = parseInt(matchRounds[1]);

    const matchAdults = tripDetailsRawText.match(/Adults:\s*(\d+)/i);
    if (matchAdults) tripDetails.adults = parseInt(matchAdults[1]);

    const matchChildren = tripDetailsRawText.match(/Children:\s*(\d+)/i);
    if (matchChildren) tripDetails.children = parseInt(matchChildren[1]);

    const matchHolidayPlans = tripDetailsRawText.match(/Holiday Plans:\s*([^|]+)/i);
    if (matchHolidayPlans) tripDetails.holiday_plans = matchHolidayPlans[1].trim();

    const matchBudgetRange = tripDetailsRawText.match(/Budget\s*:\s*£?([\d,]+)pp\s*-\s*£?([\d,]+)pp/i);
    if (matchBudgetRange) {
      tripDetails.budget_from = parseFloat(matchBudgetRange[1].replace(/,/g, ''));
      tripDetails.budget_to = parseFloat(matchBudgetRange[2].replace(/,/g, ''));
    }

    const matchAirport = tripDetailsRawText.match(/Airport\s*([^|]+)/i);
    if (matchAirport) {
      tripDetails.airport = matchAirport[1].trim();
      enquiry.airport = tripDetails.airport;
    }
  }

  const customer = travelFolder.CustomerForBooking?.DirectCustomer?.Customer;

  const customerData: CustomerData = {
    given_name: customer?.PersonName?.GivenName || null,
    surname: customer?.PersonName?.Surname || null,
    email: customer?.Email || null,
    phone_number: customer?.TelephoneInfo?.Telephone?.PhoneNumber || null,
    newsletter_opt_in: customer?.CommunicationPreferences?.Newsletter ? 1 : 0,
  };

  let passengers: Passenger[] = [];
  if (travelFolder.PassengerListItems?.PassengerListItem) {
    if (Array.isArray(travelFolder.PassengerListItems.PassengerListItem)) {
      passengers = travelFolder.PassengerListItems.PassengerListItem.map((p: any) => ({
        given_name: p.PersonName?.GivenName || null,
        surname: p.PersonName?.Surname || null,
      }));
    } else {
      const p = travelFolder.PassengerListItems.PassengerListItem;
      passengers = [{
        given_name: p.PersonName?.GivenName || null,
        surname: p.PersonName?.Surname || null,
      }];
    }
  }

  const marketing: Marketing = {
    campaign_code: travelFolder.MarketingCampaignCode ?? null,
    source: travelFolder.EnhancedData01 ?? null,
    medium: travelFolder.EnhancedData02 ?? null,
    ad_id: travelFolder.EnhancedData00 ?? null,
  };

  const pool = await initDbPool();
  const conn = await pool.getConnection();
  try {
    const [existingEnquiryRows] = await conn.execute(
      `SELECT id FROM enquiries WHERE source_booking_id = ? LIMIT 1`,
      [enquiry.source_booking_id]
    ) as [Array<{ id: number }>, any];

    if (existingEnquiryRows.length > 0) {
      console.warn(`Enquiry with source_booking_id ${enquiry.source_booking_id} already exists, skipping.`);
      return false;
    }

    await conn.beginTransaction();

    const [enquiryResult] = await conn.execute(
      `INSERT INTO enquiries 
       (source_booking_id, departure_date, create_date, STATUS, is_quote_only, destination_name, destination_country, airport)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        enquiry.source_booking_id,
        enquiry.departure_date,
        enquiry.create_date,
        enquiry.STATUS,
        enquiry.is_quote_only,
        enquiry.destination_name,
        enquiry.destination_country,
        enquiry.airport,
      ]
    ) as [ResultSetHeader, any];
    const enquiryId = enquiryResult.insertId;

    if (customer) {
      const [existingCustomerRows] = await conn.execute(
        `SELECT id FROM customers WHERE email = ? LIMIT 1`,
        [customerData.email]
      ) as [Array<{ id: number }>, any];

      if (existingCustomerRows.length === 0) {
        await conn.execute(
          `INSERT INTO customers (enquiry_id, given_name, surname, email, phone_number, newsletter_opt_in)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            enquiryId,
            customerData.given_name,
            customerData.surname,
            customerData.email,
            customerData.phone_number,
            customerData.newsletter_opt_in,
          ]
        );
      }
    }

    for (const p of passengers) {
      const [existingPassengerRows] = await conn.execute(
        `SELECT id FROM passengers WHERE enquiry_id = ? AND given_name = ? AND surname = ? LIMIT 1`,
        [enquiryId, p.given_name, p.surname]
      ) as [Array<{ id: number }>, any];
      if (existingPassengerRows.length === 0) {
        await conn.execute(
          `INSERT INTO passengers (enquiry_id, given_name, surname)
           VALUES (?, ?, ?)`,
          [enquiryId, p.given_name, p.surname]
        );
      }
    }

    const [existingTripRows] = await conn.execute(
      `SELECT id FROM trip_details WHERE enquiry_id = ? LIMIT 1`,
      [enquiryId]
    ) as [Array<{ id: number }>, any];
    if (existingTripRows.length === 0) {
      await conn.execute(
        `INSERT INTO trip_details
         (enquiry_id, hotel, nights, golfers, non_golfers, rounds, adults, children, holiday_plans, budget_from, budget_to)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
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
        ]
      );
    }

    if (marketing.campaign_code || marketing.source || marketing.medium || marketing.ad_id) {
      await conn.execute(
        `INSERT INTO marketing (enquiry_id, campaign_code, SOURCE, MEDIUM, ad_id)
     VALUES (?, ?, ?, ?, ?)`,
        [
          enquiryId,
          marketing.campaign_code,
          marketing.source,
          marketing.medium,
          marketing.ad_id,
        ]
      );
    }

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
