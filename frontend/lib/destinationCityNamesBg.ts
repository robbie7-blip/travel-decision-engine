// Bulgarian display names for the /destinations guides — display only.
// The canonical English city name (from facts/*.json) stays the value sent
// as ?dest= to the trip form and everywhere the engine matches destination
// strings, so this never touches anything functional, just what a
// Bulgarian-reading visitor sees on the page.

export const DESTINATION_CITY_NAMES_BG: Record<string, string> = {
  amsterdam: "Амстердам",
  athens: "Атина",
  barcelona: "Барселона",
  berlin: "Берлин",
  bruges: "Брюж",
  brussels: "Брюксел",
  budapest: "Будапеща",
  copenhagen: "Копенхаген",
  florence: "Флоренция",
  lisbon: "Лисабон",
  london: "Лондон",
  madrid: "Мадрид",
  munich: "Мюнхен",
  paris: "Париж",
  prague: "Прага",
  rome: "Рим",
  venice: "Венеция",
  vienna: "Виена",
};
