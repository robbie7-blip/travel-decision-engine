// Short editorial intros for the /destinations guides - deliberately kept to
// general, widely-known character rather than specific claims (prices,
// timings, named venues), since those belong in facts/*.json (or its
// Bulgarian counterpart, destinationFactsBg.ts) where they can actually be
// attributed and checked. This is atmosphere, not a fact the rest of the
// app would need to verify.

import type { Language } from "./types";

const en: Record<string, string> = {
  amsterdam:
    "Amsterdam moves at bicycle speed - canals, gabled houses, and a compactness that rewards wandering without a fixed plan.",
  athens:
    "Athens layers three thousand years into a single afternoon walk, ancient stone giving way to buzzing modern neighborhoods without much ceremony.",
  bangkok:
    "Bangkok runs on contradiction - glittering temples beside elevated highways, the calmest canals a block from the loudest markets - and rewards travelers willing to eat standing up as much as sitting down.",
  barcelona:
    "Barcelona pairs Gaudí's curves with a Mediterranean pace - long lunches, later dinners, and a city that rewards showing up without a rigid itinerary.",
  berlin:
    "Berlin wears its history openly and keeps its nightlife later than most - a city better explored district by district than ticked off a single list.",
  bruges:
    "Bruges is small enough to walk end to end, its canals and medieval core making it one of the rare old towns that isn't a reconstruction.",
  brussels:
    "Brussels runs quieter than its EU-capital reputation suggests - a walkable center built around good food as much as headline sights.",
  budapest:
    "Budapest splits across a river into two distinct moods - hillside Buda and the grid of Pest - tied together by thermal baths and ruin bars.",
  copenhagen:
    "Copenhagen rewards travelers on foot or bike, with a design sensibility that shows up as much in a corner café as in its museums.",
  dubai:
    "Dubai builds upward and outward faster than any city has a right to, but its older quarters (the creek, the souks) still move at a slower, more human pace than the skyline suggests.",
  florence:
    "Florence fits its Renaissance weight into a genuinely small old town - most of what draws people is within a 15-minute walk of the Duomo.",
  lisbon:
    "Lisbon is a city of hills and trams, its miradouros doing a lot of the work a formal itinerary usually has to.",
  london:
    "London is less a single city than a set of neighborhoods loosely stitched by the Tube - worth picking a few areas rather than trying to cover it all.",
  madrid:
    "Madrid runs later than most European capitals - museums by day, tapas crawls that start after most cities have already had dinner.",
  mexico_city:
    "Mexico City is enormous but stitches together through walkable, distinct neighborhoods - colonial plazas, modernist boulevards, market stalls - each with its own rhythm.",
  munich:
    "Munich balances Bavarian tradition with a genuinely modern city - beer gardens and English Garden sunbathing alongside serious museums.",
  new_york:
    "New York doesn't ease you in - it expects you to keep pace from the moment you arrive, and rewards travelers who pick a few neighborhoods to know well over trying to see everything.",
  paris:
    "Paris rewards slow mornings and long lunches as much as monument-hopping - arguably the rare capital where doing less is doing it right.",
  prague:
    "Prague's old town is dense and walkable, its skyline and bridges doing most of the visual work without much effort required.",
  rome:
    "Rome stacks two thousand years on top of itself - ruins beside cafés beside apartment blocks - best handled a neighborhood at a time, not a checklist.",
  singapore:
    "Singapore is compact, spotless, and genuinely multicultural block to block - a hawker centre, a Chinese temple, and a rainforest-covered mall can all sit within a five-minute walk of each other.",
  tokyo:
    "Tokyo is enormous but never feels chaotic - a city of distinct, walkable neighborhoods stitched together by a rail network precise enough to set a watch by.",
  venice:
    "Venice has no cars and barely any straight lines - getting lost in the smaller calli is closer to the point than any single sight.",
  vienna:
    "Vienna moves at a coffee-house pace - grand imperial architecture that somehow doesn't feel like it's trying to impress you.",
};

const bg: Record<string, string> = {
  amsterdam:
    "Амстердам се движи със скоростта на велосипед - канали, къщи с фронтони и компактност, която възнаграждава разходките без фиксиран план.",
  athens:
    "Атина наслагва три хиляди години в една следобедна разходка - древният камък отстъпва място на кипящи модерни квартали без много церемонии.",
  bangkok:
    "Банкок работи на противоречие - блестящи храмове до надлези, най-спокойните канали на една пряка от най-шумните пазари - и възнаграждава пътуващите, готови да ядат права, колкото и седнали.",
  barcelona:
    "Барселона съчетава извивките на Гауди със средиземноморско темпо - дълги обеди, по-късни вечери и град, който възнаграждава спонтанността без строг план.",
  berlin:
    "Берлин носи историята си открито и живота си след мрак по-късно от повечето - град, по-добре разгледан квартал по квартал, отколкото отметнат от един списък.",
  bruges:
    "Брюж е достатъчно малък, за да се обходи пеша от край до край, а каналите и средновековното му ядро го правят един от редките стари градове, които не са реконструкция.",
  brussels:
    "Брюксел тече по-тихо, отколкото предполага репутацията му на столица на ЕС - пешеходен център, изграден около добра храна не по-малко, отколкото около забележителности.",
  budapest:
    "Будапеща се разделя от река на две различни настроения - хълмистата Буда и решетката на Пеща - свързани от термални бани и руин барове.",
  copenhagen:
    "Копенхаген възнаграждава пътуващите пеша или на колело, с усет за дизайн, който се проявява в кафенето на ъгъла толкова, колкото и в музеите.",
  dubai:
    "Дубай строи нагоре и навън по-бързо, отколкото има право всеки град - но по-старите му квартали (кейа, суковете) все още се движат в по-бавен, по-човешки ритъм, отколкото подсказва силуетът.",
  florence:
    "Флоренция побира тежестта на Ренесанса в наистина малък стар град - повечето от онова, което привлича хората, е на 15 минути пеша от Duomo.",
  lisbon:
    "Лисабон е град на хълмове и трамваи, а miradouros (гледните точки) вършат голяма част от работата, която обикновено пада на формален маршрут.",
  london:
    "Лондон е по-скоро набор от квартали, свободно свързани от метрото, отколкото един-единствен град - заслужава да изберете няколко зони, вместо да опитате да обходите всичко.",
  madrid:
    "Мадрид тече по-късно от повечето европейски столици - музеи през деня, тапас обиколки, които започват, след като повечето градове вече са вечеряли.",
  mexico_city:
    "Мексико Сити е огромен, но се държи заедно през удобни за пеша, различни квартали - колониални площади, модернистки булеварди, пазарни сергии - всеки със свой собствен ритъм.",
  munich:
    "Мюнхен балансира баварската традиция с наистина модерен град - бирени градини и слънчеви бани в English Garden редом със сериозни музеи.",
  new_york:
    "Ню Йорк не те въвежда бавно - очаква да следваш темпото от момента на пристигане, и възнаграждава пътуващите, които избират няколко квартала да опознаят добре, вместо да опитат да видят всичко.",
  paris:
    "Париж възнаграждава бавните сутрини и дългите обеди не по-малко от обиколките на паметници - вероятно рядката столица, където да правиш по-малко е правилният подход.",
  prague:
    "Старият град на Прага е гъст и удобен за пеша, а силуетът и мостовете му вършат по-голямата част от визуалната работа без много усилие.",
  rome:
    "Рим натрупва две хиляди години един върху друг - руини до кафенета до жилищни блокове - най-добре се разглежда квартал по квартал, не по списък.",
  singapore:
    "Сингапур е компактен, безупречно чист и истински мултикултурен на всеки ъгъл - фуд корт, китайски храм и мол с дъждовна гора могат да се съберат в петминутна разходка един от друг.",
  tokyo:
    "Токио е огромен, но никога не се усеща хаотичен - град от отделни, удобни за пеша квартали, свързани от железопътна мрежа, точна колкото часовник.",
  venice:
    "Венеция няма коли и почти никакви прави линии - да се изгубиш в по-малките calli е по-близо до смисъла, отколкото която и да е отделна забележителност.",
  vienna:
    "Виена се движи с темпото на кафене - величествена имперска архитектура, която някак не се чувства, че се опитва да те впечатли.",
};

export const DESTINATION_INTROS: Record<Language, Record<string, string>> = { en, bg };
