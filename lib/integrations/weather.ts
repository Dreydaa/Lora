export async function getWeather() {
  const latitude = process.env.WEATHER_LAT ?? "48.8566";
  const longitude = process.env.WEATHER_LON ?? "2.3522";
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`,
    { signal: AbortSignal.timeout(4000) },
  );
  if (!response.ok) return "Météo indisponible";
  const data = (await response.json()) as {
    current?: { temperature_2m?: number; weather_code?: number };
  };
  return `${data.current?.temperature_2m ?? "?"}°C (code ${data.current?.weather_code ?? "?"})`;
}
