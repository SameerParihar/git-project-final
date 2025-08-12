import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
let currentStation = "Vaishali";

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.set("view engine", "ejs");

const db = new pg.Client({
  connectionString: process.env.DB_VAISHALI_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

db.connect()
  .then(() => console.log("✅ Connected to vaishali DB"))
  .catch((err) => {
    console.error("❌ Failed to connect to vaishali DB:", err.message);
    process.exit(1);
  });

app.get("/", (req, res) => {
  res.redirect("/dashboard");
});

app.post("/set-station", (req, res) => {
  const { station } = req.body;
  if (station) {
    currentStation = station;
    console.log("Station updated to:", currentStation);
  }
  res.redirect(req.headers.referer || "/");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

/* employees */
app.get("/employees", async (req, res) => {
  const selectedDate = req.query.date || new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  try {
    const employeesResult = await db.query(
      `SELECT e.*, d.age, d.blood_group, d.email, d.phone_no
       FROM employee e
       JOIN emp_data d ON e.id = d.id AND LOWER(e.station) = LOWER(d.station)
       WHERE LOWER(e.station) = LOWER($1) AND e.date = $2
       ORDER BY e.id`,
      [currentStation, selectedDate]
    );

    const historyResult = await db.query(
      `SELECT id, date, in_time
       FROM employee
       WHERE LOWER(station) = LOWER($1)
         AND date >= (CURRENT_DATE - INTERVAL '6 days')
         AND date <= CURRENT_DATE
       ORDER BY date DESC`,
      [currentStation]
    );

    const countsResult = await db.query(
      `SELECT
         id,
         COUNT(*) FILTER (WHERE in_time IS NOT NULL AND in_time <= '10:35') AS ontime,
         COUNT(*) FILTER (WHERE in_time > '10:35' AND in_time <= '10:45') AS late,
         COUNT(*) FILTER (WHERE in_time IS NULL) AS absent
       FROM employee
       WHERE LOWER(station) = LOWER($1)
         AND date <= $2
       GROUP BY id`,
      [currentStation, today]
    );

    const historyMap = {};
    historyResult.rows.forEach(row => {
      if (!historyMap[row.id]) historyMap[row.id] = [];
      historyMap[row.id].push(row);
    });

    const countsMap = {};
    countsResult.rows.forEach(row => {
      countsMap[row.id] = {
        ontime: parseInt(row.ontime) || 0,
        late: parseInt(row.late) || 0,
        absent: parseInt(row.absent) || 0,
      };
    });

    res.render("employees.ejs", {
      rows: employeesResult.rows,
      historyMap,
      countsMap,
      activeTab: "employees",
      station: currentStation,
      selectedDate,
      today
    });
  } catch (err) {
    console.error("Error fetching employees data:", err);
    res.status(500).send("Error fetching employees data");
  }
});

app.post("/mark-attendance/:id/:type", async (req, res) => {
  const { id, type } = req.params;
  const now = new Date().toTimeString().slice(0, 8);
  const today = new Date().toISOString().slice(0, 10);

  try {
    if (type === "in") {
      await db.query(
        "UPDATE employee SET in_time = $1 WHERE id = $2 AND date = $3 AND LOWER(station) = LOWER($4)",
        [now, id, today, currentStation]
      );
    } else if (type === "out") {
      await db.query(
        "UPDATE employee SET out_time = $1 WHERE id = $2 AND date = $3 AND LOWER(station) = LOWER($4)",
        [now, id, today, currentStation]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

/* dashboard */
app.get("/dashboard", async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  try {
    const lateResult = await db.query(
      `SELECT e.*, d.age, d.blood_group, d.email, d.phone_no
       FROM employee e
       JOIN emp_data d ON e.id = d.id AND LOWER(e.station) = LOWER(d.station)
       WHERE LOWER(e.station) = LOWER($1)
         AND e.date = $2
         AND e.in_time > '10:35'
       ORDER BY e.id`,
      [currentStation, today]
    );

    const absentResult = await db.query(
      `SELECT e.*, d.age, d.blood_group, d.email, d.phone_no
       FROM employee e
       JOIN emp_data d ON e.id = d.id AND LOWER(e.station) = LOWER(d.station)
       WHERE LOWER(e.station) = LOWER($1)
         AND e.date = $2
         AND e.in_time IS NULL
       ORDER BY e.id`,
      [currentStation, today]
    );

    const suppliesResult = await db.query(
      `SELECT id, item_name, current_volume FROM supplies WHERE LOWER(station) = LOWER($1) AND date = $2 ORDER BY item_name`,
      [currentStation, today]
    );

    const binsResult = await db.query(
      `SELECT id, bin_name, current_volume FROM bins WHERE LOWER(station) = LOWER($1) AND date = $2 ORDER BY bin_name`,
      [currentStation, today]
    );

    const maxSupplyVolume = 10;
    const maxBinVolume = 50;

    const redSupplies = suppliesResult.rows.filter(item => (item.current_volume / maxSupplyVolume) * 100 < 25);
    const yellowSupplies = suppliesResult.rows.filter(item => {
      const percent = (item.current_volume / maxSupplyVolume) * 100;
      return percent >= 25 && percent < 50;
    });

    const redBins = binsResult.rows.filter(bin => (bin.current_volume / maxBinVolume) * 100 > 75);
    const yellowBins = binsResult.rows.filter(bin => {
      const percent = (bin.current_volume / maxBinVolume) * 100;
      return percent >= 50 && percent <= 75;
    });

    res.render("dashboard.ejs", {
      activeTab: "dashboard",
      station: currentStation,
      today,
      lateEmployees: lateResult.rows,
      absentEmployees: absentResult.rows,
      redSupplies,
      yellowSupplies,
      redBins,
      yellowBins,
      maxSupplyVolume,
      maxBinVolume,
    });
  } catch (err) {
    console.error("Error fetching dashboard data:", err);
    res.status(500).send("Error fetching dashboard data");
  }
});

/* supplies */
const maxVolume = 10;

app.get("/supplies", async (req, res) => {
  try {
    const station = currentStation;
    const selectedDate = req.query.date || new Date().toISOString().slice(0, 10);
    const startOfMonth = new Date(selectedDate.slice(0, 7) + "-01").toISOString().slice(0, 10);
    const endOfMonth = new Date(new Date(startOfMonth).getFullYear(), new Date(startOfMonth).getMonth() + 1, 0).toISOString().slice(0, 10);

    const suppliesTodayResult = await db.query(
      `SELECT * FROM supplies WHERE LOWER(station) = LOWER($1) AND date = $2 ORDER BY id`,
      [station, selectedDate]
    );
    const binsTodayResult = await db.query(
      `SELECT * FROM bins WHERE LOWER(station) = LOWER($1) AND date = $2 ORDER BY id`,
      [station, selectedDate]
    );

    const suppliesMonthlyResult = await db.query(
      `SELECT * FROM supplies WHERE LOWER(station) = LOWER($1) AND date >= $2 AND date <= $3 ORDER BY id`,
      [station, startOfMonth, endOfMonth]
    );
    const binsMonthlyResult = await db.query(
      `SELECT * FROM bins WHERE LOWER(station) = LOWER($1) AND date >= $2 AND date <= $3 ORDER BY id`,
      [station, startOfMonth, endOfMonth]
    );

    const maxSupplyVolume = 10;
    const maxBinVolume = 50;

    res.render("supplies.ejs", {
      activeTab: "supplies",
      station,
      suppliesToday: suppliesTodayResult.rows,
      binsToday: binsTodayResult.rows,
      suppliesMonthly: suppliesMonthlyResult.rows,
      binsMonthly: binsMonthlyResult.rows,
      maxSupplyVolume,
      maxBinVolume,
      today: selectedDate
    });
  } catch (err) {
    console.error("Error fetching supplies or bins:", err);
    res.status(500).send("Error loading supplies and bins");
  }
});

app.post("/supplies/update/:type/:id", async (req, res) => {
  const { type, id } = req.params;
  const { current_volume } = req.body;
  const today = new Date().toISOString().slice(0, 10);

  if (!["supply", "bin"].includes(type)) {
    return res.status(400).send("Invalid type");
  }

  if (isNaN(current_volume) || current_volume < 0) {
    return res.status(400).send("Invalid volume");
  }

  const tableName = type === "supply" ? "supplies" : "bins";

  try {
    await db.query(
      `UPDATE ${tableName} SET current_volume = $1 WHERE id = $2 AND date = $3 AND LOWER(station) = LOWER($4)`,
      [current_volume, id, today, currentStation]
    );
    res.status(200).send("Volume updated");
  } catch (err) {
    console.error("Error updating volume:", err);
    res.status(500).send("Failed to update volume");
  }
});

/* messages */
app.get("/messages", (req, res) => {
  let atmessages = true;
  res.render("messages.ejs", {
    activeTab: "messages",
    station: currentStation,
  });
});