// Open-Meteo: model precip (past + forecast), soil moisture, temperature. Free, CORS, no key.
import { ENDPOINTS } from "../config.js";
import { getJSON } from "../util.js";

export async function pointWeather(lat, lon, { pastDays = 7, forecastDays = 7 } = {}) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4), timezone: "America/Chicago",
    precipitation_unit: "inch", temperature_unit: "fahrenheit", wind_speed_unit: "mph",
    past_days: pastDays, forecast_days: forecastDays,
    hourly: "precipitation,rain,snowfall,soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,soil_moisture_28_to_100cm,temperature_2m",
    daily: "precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,snowfall_sum",
  });
  return getJSON(`${ENDPOINTS.openMeteo}?${q}`, { ttl: 15 * 60_000 });
}
