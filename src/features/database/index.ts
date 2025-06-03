import snowflake from 'snowflake-sdk';
import * as fs from "fs";
import * as path from "path";
import { decode } from "he";
import { XMLParser } from 'fast-xml-parser';
import { getSourceTypeFromFileName, settings } from '../../utils';

let connection: snowflake.Connection | null = null;
let config: any = null;

async function initDbConnection() {
  if (connection) return connection;

  config = await settings.getSnowflakeConfig();

  if (!config) throw new Error('Snowflake config is missing');

  connection = snowflake.createConnection({
    account: config.account,
    username: config.username,
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

export async function saveParsedTravelFolder(xmlString: string, fileName: string): Promise<boolean> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const json = parser.parse(xmlString);
  const travelFolder = json.DTM_TravelFolder.TravelFolder;
  const sourceType = getSourceTypeFromFileName(fileName);

  const enquiry: Enquiry = {
    source_booking_id: travelFolder.SourceBookingID ?? "",
    departure_date: travelFolder.BookingDepartureDate ?? null,
    create_date: travelFolder.SourceBookingCreateDate ?? null,
    STATUS: travelFolder.WorkflowStatus ?? null,
    is_quote_only: travelFolder.IsQuoteOnly === "true" ? 1 : 0,
    destination_name: "",
    destination_country: travelFolder.BookingDestinationCountryCode ?? "",
    airport: "",
    source_type: sourceType || "",
  };

  const comments = travelFolder.ReservationCommentItems?.ReservationCommentItem;
  let tripDetailsRawText = Array.isArray(comments)
    ? comments.map(c => c.Text).join(" | ")
    : comments?.Text || "";

  const parts = tripDetailsRawText.split('|').map((p: string) => p.trim());

  const kvMap: Record<string, string> = {};
  for (const part of parts) {
    if (!part) continue;

    const colonIndex = part.indexOf(':');
    let key = '';
    let value = '';

    if (colonIndex !== -1) {
      key = part.slice(0, colonIndex).trim().toLowerCase();
      value = part.slice(colonIndex + 1).trim();
    } else {
      const spaceIndex = part.indexOf(' ');
      if (spaceIndex !== -1) {
        key = part.slice(0, spaceIndex).trim().toLowerCase();
        value = part.slice(spaceIndex + 1).trim();
      } else {
        key = part.trim().toLowerCase();
        value = '';
      }
    }

    if (key) kvMap[key] = decode(value);
  }

  const tripDetails: TripDetails = {
    hotel: kvMap['hotel'] || '',
    nights: kvMap['nights'] ? parseInt(kvMap['nights']) || null : null,
    golfers: kvMap['golfers'] ? parseInt(kvMap['golfers']) || null : null,
    non_golfers: kvMap['non golfers'] ? parseInt(kvMap['non golfers']) || null : null,
    rounds: kvMap['rounds'] ? parseInt(kvMap['rounds']) || null : null,
    adults: kvMap['adults'] ? parseInt(kvMap['adults']) || null : null,
    children: kvMap['children'] ? parseInt(kvMap['children']) || null : null,
    holiday_plans: kvMap['holiday plans'] || null,
    airport: kvMap['airport'] || null,
    budget_from: null,
    budget_to: null,
  };

  enquiry.destination_name = kvMap['destination'] ?? null;

  const budgetMatch = tripDetailsRawText.match(/Budget\s*:\s*£?([\d,]+)pp\s*-\s*£?([\d,]+)pp/i);
  if (budgetMatch) {
    const toFloat = (val: string) => parseFloat(val.replace(/,/g, '')) || null;
    tripDetails.budget_from = toFloat(budgetMatch[1]);
    tripDetails.budget_to = toFloat(budgetMatch[2]);
  }

  enquiry.airport = tripDetails.airport;

  const customer = travelFolder.CustomerForBooking?.DirectCustomer?.Customer;
  const customerData: CustomerData = {
    given_name: customer?.PersonName?.GivenName || null,
    surname: customer?.PersonName?.Surname || null,
    email: customer?.Email || null,
    phone_number: customer?.TelephoneInfo?.Telephone?.PhoneNumber || null,
    newsletter_opt_in: customer?.CommunicationPreferences?.Newsletter ? 1 : 0,
  };

  const rawPassengers = travelFolder.PassengerListItems?.PassengerListItem;
  const passengers: Passenger[] = (Array.isArray(rawPassengers)
    ? rawPassengers
    : rawPassengers ? [rawPassengers] : [])
    .map((p: any) => ({
      given_name: p.PersonName?.GivenName || null,
      surname: p.PersonName?.Surname || null,
    }));

const csvLine = `"${fileName.replace(/"/g, '""')}",${passengers.length}\n`;
  const csvPath = path.resolve("parsed_passengers_report.csv");

  // If file doesn't exist, write headers first
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, 'filename,passenger_count\n', { flag: 'wx' });
  }
  // Append the line (filename, number_of_passengers)
  fs.appendFileSync(csvPath, csvLine);

  const marketing: Marketing = {
    campaign_code: travelFolder.MarketingCampaignCode ?? null,
    source: travelFolder.EnhancedData01 ?? null,
    medium: travelFolder.EnhancedData02 ?? null,
    ad_id: travelFolder.EnhancedData00 ?? null,
  };

  const conn = await initDbConnection();

  const existing = await query(conn, `SELECT ID FROM ENQUIRIES WHERE SOURCE_BOOKING_ID = ? LIMIT 1`, [enquiry.source_booking_id]);
  if (existing.length > 0) {
    console.debug(`Enquiry with SOURCE_BOOKING_ID ${enquiry.source_booking_id} already exists, skipping.`);
    return false;
  }

  console.debug(`Inserting new enquiry with SOURCE_BOOKING_ID ${enquiry.source_booking_id}`);

  await query(conn, `
    INSERT INTO ENQUIRIES (SOURCE_BOOKING_ID, DEPARTURE_DATE, CREATE_DATE, STATUS, IS_QUOTE_ONLY, DESTINATION_NAME, DESTINATION_COUNTRY, AIRPORT, SOURCE_TYPE)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    enquiry.source_booking_id,
    enquiry.departure_date,
    enquiry.create_date,
    enquiry.STATUS,
    enquiry.is_quote_only,
    enquiry.destination_name,
    enquiry.destination_country,
    enquiry.airport,
    enquiry.source_type,
  ]);

  const insertedEnquiry = await query(conn, `SELECT ID FROM ENQUIRIES WHERE SOURCE_BOOKING_ID = ?`, [enquiry.source_booking_id]);
  const enquiryId = insertedEnquiry[0].ID;

  const tripExists = await query(conn, `SELECT ID FROM TRIP_DETAILS WHERE ENQUIRY_ID = ? LIMIT 1`, [enquiryId]);
  if (tripExists.length === 0) {
    await query(conn, `
      INSERT INTO TRIP_DETAILS (ENQUIRY_ID, HOTEL, NIGHTS, GOLFERS, NON_GOLFERS, ROUNDS, ADULTS, CHILDREN, HOLIDAY_PLANS, BUDGET_FROM, BUDGET_TO)
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


  if (customerData.email) {
    const existing = await query(conn, `SELECT ID FROM CUSTOMERS WHERE EMAIL = ? LIMIT 1`, [customerData.email]);
    if (existing.length === 0) {
      await query(conn, `
        INSERT INTO CUSTOMERS (ENQUIRY_ID, GIVEN_NAME, SURNAME, EMAIL, PHONE_NUMBER, NEWSLETTER_OPT_IN)
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

  for (const p of passengers) {
    const existing = await query(conn,
      `SELECT ID FROM PASSENGERS WHERE ENQUIRY_ID = ? AND GIVEN_NAME = ? AND SURNAME = ? LIMIT 1`,
      [enquiryId, p.given_name, p.surname]
    );
    if (existing.length === 0) {
      await query(conn, `
        INSERT INTO PASSENGERS (ENQUIRY_ID, GIVEN_NAME, SURNAME)
        VALUES (?, ?, ?)`, [
        enquiryId, p.given_name, p.surname
      ]);
    }
  }

  if (marketing.campaign_code || marketing.source || marketing.medium || marketing.ad_id) {
    const existing = await query(conn,
      `SELECT ID FROM MARKETING WHERE ENQUIRY_ID = ? LIMIT 1`,
      [enquiryId]
    );
    if (existing.length === 0) {
      await query(conn, `
      INSERT INTO MARKETING (ENQUIRY_ID, CAMPAIGN_CODE, SOURCE, MEDIUM, AD_ID)
      VALUES (?, ?, ?, ?, ?)`, [
        enquiryId,
        marketing.campaign_code,
        marketing.source,
        marketing.medium,
        marketing.ad_id,
      ]);
    }
  }

  return true;
}
