// The blog's first posts, added from /admin/blog with one button (see
// app/api/admin/blog/starter). Each is in English and Bulgarian.
//
// Covers are the site's own destination photos, with the credit their
// licence asks for, taken from lib/destinationPhotoCredits.ts rather than
// written again here. Facts were checked against the sources listed under
// each post; nothing that changes often (prices, opening hours) is stated
// without a date.

import { DESTINATION_PHOTO_CREDITS } from "./destinationPhotoCredits";
import { getPublishedPost, savePost, setPostStatus, type BlogInput } from "./blogQuery";
import type { Queryable } from "./tripsQuery";

function cover(city: string, alt: string): Pick<BlogInput, "coverUrl" | "coverAlt" | "coverCredit" | "coverCreditUrl"> {
  const credit = DESTINATION_PHOTO_CREDITS[city];
  if (!credit) {
    return { coverUrl: `/destinations/${city}.jpg`, coverAlt: alt, coverCredit: null, coverCreditUrl: null };
  }
  return {
    coverUrl: `/destinations/${credit.file}`,
    coverAlt: alt,
    coverCredit: `${credit.artist}, ${credit.license}, via Wikimedia Commons`,
    coverCreditUrl: credit.sourceUrl,
  };
}

const VENICE_SOURCES = [
  { title: "Venice kept dry as MOSE wards off a high tide (AFP, October 2020)", url: "https://news.yahoo.com/venice-kept-dry-dam-system-113742824.html" },
  { title: "Venice's flood barriers prevent a deluge (Artnet News)", url: "https://news.artnet.com/art-world/venice-flood-barriers-1912983" },
  { title: "Venice's access fee is back in 2026 (Rick Steves)", url: "https://blog.ricksteves.com/insights/?p=131" },
];
const BERLIN_SOURCES = [
  { title: "East Side Gallery (Google Arts & Culture)", url: "https://artsandculture.google.com/partner/east-side-gallery" },
  { title: "Berlin's East Side Gallery history", url: "https://walled-in-berlin.com/j-elke-ertle/berlins-east-side-gallery-history/" },
];
const LISBON_SOURCES = [
  { title: "Lisbon Tram 28: 9 things you need to know (Devour Tours)", url: "https://devourtours.com/blog/lisbon-tram-28/" },
  { title: "Lisbon Tram 28 alternatives (The Better Vacation)", url: "https://thebettervacation.com/lisbon-tram-28-alternatives" },
];
const PRAGUE_SOURCES = [
  { title: "Prague astronomical clock (Wikipedia)", url: "https://en.wikipedia.org/wiki/Prague_astronomical_clock" },
  { title: "Prague timeline (Prague.eu)", url: "https://Prague.eu/en/articles/timeline-14397" },
];

export const STARTER_POSTS: BlogInput[] = [
  // ---------------------------------------------------------------- Venice
  {
    language: "en",
    slug: "how-venice-learned-to-hold-back-the-sea",
    title: "How Venice learned to hold back the sea",
    excerpt: "Seventy-eight yellow gates under the lagoon, raised when the tide comes in. The story of how Venice stopped drowning, and what it means for your visit.",
    destinations: ["Venice"],
    sources: VENICE_SOURCES,
    ...cover("venice", "The Grand Canal in Venice with the Salute church"),
    body: `In November 2019 the water in Venice rose higher than it had in more than fifty years. Saint Mark's Square became a lake, the crypt of the basilica flooded, and shopkeepers waded through their own doorways. The city had been promised a solution for decades. Less than a year later, it finally worked.

## The gates under the lagoon

The system is called MOSE, after Moses parting the sea. It is a line of 78 hollow steel gates lying flat on the seabed at the three openings between the lagoon and the Adriatic: **Lido**, **Malamocco** and **Chioggia**.

When a high tide is forecast, compressed air is pumped into the gates. They rise, hinge upwards and form a wall that keeps the sea out of the lagoon for as long as the tide lasts. When it falls, the air is let out and the gates sink back out of sight.

On 3 October 2020 the gates were raised against a real storm for the first time. Outside, the tide climbed. Inside, Saint Mark's Square stayed dry. Twelve days later they did it again.

## Not a happy ending yet

MOSE was finished years late and far over budget, after a corruption scandal that reached the city's own government. It is also expensive to raise, so it is only used for the highest tides. Smaller floods, the kind locals call *acqua alta*, still reach the lowest streets a few times a year, which is why you will sometimes see raised walkways stacked in the squares.

The long-term question is bigger: if sea levels keep rising, the gates will have to close more and more often, and a lagoon that is closed too often stops being a lagoon.

## What it means if you are going

- **Autumn and winter** are when high tides happen. With MOSE they rarely ruin a visit, but waterproof shoes are still a good idea from October to January.
- **Day trips** on busy spring and summer dates now come with an access fee, introduced in 2024. In 2026 it was €5 booked in advance and €10 at short notice. If you stay overnight you don't pay, but you still register.
- **Stay a night.** The city you get after the day crowds leave, quiet canals and empty bridges, is the one most people never see.

If you want to see it properly, our [Venice guide](/destinations/venice) has what decide already knows about the city, from getting around to what to skip.`,
  },
  {
    language: "bg",
    slug: "kak-venetsiya-se-nauchi-da-spira-moreto",
    title: "Как Венеция се научи да спира морето",
    excerpt: "Седемдесет и осем жълти шлюза под лагуната, които се вдигат при прилив. Историята за това как Венеция спря да потъва и какво значи това за твоето пътуване.",
    destinations: ["Венеция"],
    sources: VENICE_SOURCES,
    ...cover("venice", "Канале Гранде във Венеция с църквата Санта Мария дела Салуте"),
    body: `През ноември 2019 г. водата във Венеция се вдигна по-високо от когато и да било за повече от петдесет години. Площад „Сан Марко" се превърна в езеро, криптата на базиликата беше наводнена, а търговците газеха във водата пред собствените си врати. На града от десетилетия обещаваха решение. По-малко от година по-късно то най-сетне проработи.

## Шлюзовете под лагуната

Системата се казва MOSE, на името на Мойсей, който разделил морето. Това са 78 кухи стоманени шлюза, които лежат плоско на дъното при трите входа между лагуната и Адриатическо море: **Лидо**, **Маламоко** и **Киоджа**.

Когато се очаква висок прилив, в шлюзовете се вкарва сгъстен въздух. Те се изправят и образуват стена, която държи морето извън лагуната, докато трае приливът. После въздухът се изпуска и шлюзовете отново потъват, без да се виждат.

На 3 октомври 2020 г. шлюзовете бяха вдигнати срещу истинска буря за първи път. Отвън водата се качваше. Отвътре площад „Сан Марко" остана сух. Дванадесет дни по-късно това се повтори.

## Историята още не е свършила

MOSE беше завършена с години закъснение и много над бюджета, след корупционен скандал, стигнал до самото градско управление. Вдигането на шлюзовете е и скъпо, затова се прави само при най-високите приливи. По-малките наводнения, които местните наричат *acqua alta*, все още стигат до най-ниските улици по няколко пъти в годината. Затова понякога ще видиш струпани по площадите повдигнати пътеки.

Големият въпрос е в бъдеще: ако морското равнище продължава да се покачва, шлюзовете ще се затварят все по-често, а лагуна, която е затворена твърде често, престава да бъде лагуна.

## Какво значи това, ако отиваш

- **Есента и зимата** са сезонът на високите приливи. С MOSE те рядко развалят пътуване, но от октомври до януари водоустойчиви обувки пак са добра идея.
- **Еднодневните посещения** в натоварените пролетни и летни дни вече са с такса за вход, въведена през 2024 г. През 2026 г. тя беше 5 евро при ранна резервация и 10 евро в последния момент. Ако нощуваш в града, не плащаш, но пак се регистрираш.
- **Остани поне една нощ.** Венеция след като еднодневните тълпи си тръгнат, с тихи канали и празни мостове, е градът, който повечето хора никога не виждат.

Ако искаш да я разгледаш както трябва, в нашия [пътеводител за Венеция](/bg/destinations/venice) има всичко, което decide вече знае за града, от придвижването до това какво да пропуснеш.`,
  },

  // ---------------------------------------------------------------- Lisbon
  {
    language: "en",
    slug: "lisbon-without-the-tram-28-queue",
    title: "Lisbon without the Tram 28 queue",
    excerpt: "The famous yellow tram is worth riding, just not the way most people do it. How to see the same hills, views and pastries with half the wait.",
    destinations: ["Lisbon"],
    sources: LISBON_SOURCES,
    ...cover("lisbon", "Rooftops and churches of the Alfama district in Lisbon"),
    body: `Every guide to Lisbon tells you to ride Tram 28. That is exactly the problem. In summer the queue at Martim Moniz can take longer than the ride itself, and once you are on board you will mostly see other people's elbows.

The good news: the city that tram rattles through is easy to enjoy without it.

## Ride the yellow tram the smart way

- **Start at the other end.** Board at Campo de Ourique instead of Martim Moniz. Most visitors get off before they reach this side of the line, so you are far more likely to get a seat.
- **Take the 12E instead.** It uses the same vintage carriages and climbs through the same corner of Alfama, past the cathedral and the Santa Luzia viewpoint, with a fraction of the crowd.
- **Go early.** Before 8 in the morning the tram is mostly locals on their way to work, which is also how it was meant to be used.

## The views are free

Lisbon is built on hills, and its viewpoints (*miradouros*) are the best thing in the city that costs nothing.

- **Miradouro da Senhora do Monte**: one of the highest in the city, with the castle and the river below you. Quieter than the famous ones.
- **Santa Luzia and Portas do Sol**: next to each other in Alfama, with tiled walls and the river behind the rooftops. Go at sunset.
- **Graça**: a terrace café under pine trees, where locals actually sit.

## Belém, but in the right order

Belém has the [Jerónimos Monastery](https://en.wikipedia.org/wiki/Jer%C3%B3nimos_Monastery), the riverside Belém Tower and the bakery that has been making *pastéis de Belém* since 1837. Most people queue for the pastries first and the monastery second. Do it the other way round: the queue for custard tarts moves fast, and they taste better warm after a walk.

## When you've had enough of the hills

- **LX Factory**: an old industrial complex under the 25 de Abril Bridge, now full of bookshops, studios and places to eat.
- **Sintra**: the fairytale palaces in the hills are about 40 minutes by train from Rossio station. Go on a weekday and start early.

Our [Lisbon guide](/destinations/lisbon) has more of what locals do instead, and decide can turn it into a day-by-day plan in under a minute.`,
  },
  {
    language: "bg",
    slug: "lisabon-bez-opashkata-za-tramvay-28",
    title: "Лисабон без опашката за трамвай 28",
    excerpt: "Прочутият жълт трамвай си струва, но не по начина, по който го карат повечето хора. Как да видиш същите хълмове, гледки и сладкиши с половината чакане.",
    destinations: ["Лисабон"],
    sources: LISBON_SOURCES,
    ...cover("lisbon", "Покриви и църкви в квартал Алфама в Лисабон"),
    body: `Всеки пътеводител за Лисабон ти казва да се качиш на трамвай 28. Точно там е проблемът. През лятото опашката на Мартим Мониш може да е по-дълга от самото пътуване, а вътре ще виждаш предимно чужди лакти.

Добрата новина: градът, през който трополи този трамвай, лесно се разглежда и без него.

## Как да се возиш на жълтия трамвай умно

- **Качи се от другия край.** Тръгни от Кампо де Оурике, а не от Мартим Мониш. Повечето туристи слизат, преди да стигнат дотук, така че шансът да седнеш е много по-голям.
- **Хвани 12E.** Той е със същите стари вагони и се изкачва през същата част на Алфама, покрай катедралата и площадката Санта Лузия, но с много по-малко хора.
- **Тръгни рано.** Преди 8 сутринта в трамвая са предимно местни на път за работа, точно за което е създаден.

## Гледките са безплатни

Лисабон е построен на хълмове, а неговите площадки за гледки (*miradouros*) са най-хубавото безплатно нещо в града.

- **Мирадоуро да Сеньора до Монте**: една от най-високите в града, с крепостта и реката под теб. По-спокойна от прочутите.
- **Санта Лузия и Порташ до Сол**: една до друга в Алфама, с облицовани с плочки стени и реката зад покривите. Иди по залез.
- **Граса**: кафене на тераса под борове, където наистина сядат местните.

## Белем, но в правилния ред

В Белем са [манастирът Жеронимуш](https://en.wikipedia.org/wiki/Jer%C3%B3nimos_Monastery), кулата Белем на брега на реката и сладкарницата, която прави *pastéis de Belém* от 1837 г. Повечето хора първо чакат за пастичките, а после за манастира. Направи го наобратно: опашката за кремовите тарталети се движи бързо, а и те са по-вкусни топли след разходка.

## Когато хълмовете ти дойдат в повече

- **LX Factory**: стар индустриален комплекс под моста „25 април", сега пълен с книжарници, ателиета и места за хапване.
- **Синтра**: приказните дворци в хълмовете са на около 40 минути с влак от гара Росиу. Иди в делничен ден и тръгни рано.

В нашия [пътеводител за Лисабон](/bg/destinations/lisbon) има още за това какво правят местните вместо това, а decide може да го превърне в план ден по ден за по-малко от минута.`,
  },

  // ---------------------------------------------------------------- Berlin
  {
    language: "en",
    slug: "where-to-still-see-the-berlin-wall",
    title: "Where you can still see the Berlin Wall",
    excerpt: "It stood for 28 years and fell in a night. Most of it is gone, but if you know where to look, the Wall is still all over Berlin.",
    destinations: ["Berlin"],
    sources: BERLIN_SOURCES,
    ...cover("berlin", "The Brandenburg Gate in Berlin in the morning"),
    body: `On the night of 13 August 1961, East German soldiers began closing the border through the middle of Berlin. By morning, streets were cut in half and families were separated by barbed wire that would become a concrete wall. It stood for 28 years, until the evening of 9 November 1989, when the border opened and people climbed onto it with hammers.

Most of the Wall was torn down within a few years. But it hasn't disappeared, and the places where it survives are some of the most moving in Europe.

## East Side Gallery: the longest piece left

Along the Spree river in Friedrichshain runs the longest surviving stretch, about 1.3 kilometres. In 1990, artists from around the world painted its eastern side, the side that East Berliners had never been allowed to approach. Look for the famous *Fraternal Kiss* between Brezhnev and Honecker.

Go early in the morning or on a weekday evening: by midday the most famous murals have a crowd taking the same photo.

## Bernauer Straße: where you understand it

If you only see one place, make it the Berlin Wall Memorial on Bernauer Straße. Here the border ran along the front of the houses: people jumped from their windows to the western pavement in the first weeks.

A section has been kept exactly as it was, with the inner wall, the "death strip" and the watchtower, and you can look down on it from the viewing platform across the road. Small markers in the ground show where escape tunnels were dug.

## The line that runs through the city

Watch the pavement as you walk around central Berlin. A double row of cobblestones marks where the Wall used to stand. It crosses roads, squares and courtyards, and it is the easiest way to understand how completely the city was divided.

## Two more

- **Checkpoint Charlie**: the guard hut is a replica and the area is busy, but the museum next to it tells the escape stories well.
- **Mauerpark**: "Wall Park" sits on part of the old death strip. On Sundays there is a flea market, and in summer a big open-air karaoke in the amphitheatre.

Our [Berlin guide](/destinations/berlin) has more of the city, and decide can put the Wall sites into a plan that makes sense on the map.`,
  },
  {
    language: "bg",
    slug: "kade-oshte-mozhesh-da-vidish-berlinskata-stena",
    title: "Къде все още можеш да видиш Берлинската стена",
    excerpt: "Стоя 28 години и падна за една нощ. Повечето от нея я няма, но ако знаеш къде да гледаш, Стената все още е навсякъде в Берлин.",
    destinations: ["Берлин"],
    sources: BERLIN_SOURCES,
    ...cover("berlin", "Бранденбургската врата в Берлин сутрин"),
    body: `През нощта на 13 август 1961 г. източногерманските войници започнаха да затварят границата през самия център на Берлин. До сутринта улици бяха разрязани на две, а семейства бяха разделени от бодлива тел, която щеше да стане бетонна стена. Тя стоя 28 години, до вечерта на 9 ноември 1989 г., когато границата се отвори и хората се качиха върху нея с чукове.

Повечето от Стената беше съборена до няколко години. Но тя не е изчезнала, а местата, където е оцеляла, са сред най-вълнуващите в Европа.

## Ист Сайд Галъри: най-дългото оцеляло парче

Покрай река Шпре във Фридрихсхайн минава най-дългият запазен участък, около 1,3 километра. През 1990 г. художници от цял свят изрисуваха източната му страна, онази, до която източноберлинчани никога не са имали право да се приближат. Потърси прочутата *Братска целувка* между Брежнев и Хонекер.

Иди рано сутрин или вечер в делничен ден: по обед пред най-известните стенописи има тълпа, която прави една и съща снимка.

## Бернауер Щрасе: където разбираш всичко

Ако видиш само едно място, нека е Мемориалът на Берлинската стена на Бернауер Щрасе. Тук границата минаваше по фасадите на къщите: в първите седмици хората скачаха от прозорците си на западния тротоар.

Един участък е запазен точно какъвто беше, с вътрешната стена, „ивицата на смъртта" и наблюдателната кула, а можеш да го видиш отгоре от площадката за наблюдение отсреща. Малки знаци в земята показват къде са копани тунели за бягство.

## Линията, която минава през града

Гледай паважа, докато се разхождаш из центъра на Берлин. Двоен ред павета отбелязва къде е стояла Стената. Тя пресича улици, площади и дворове и това е най-лесният начин да разбереш колко изцяло е бил разделен градът.

## Още две места

- **Чекпойнт Чарли**: будката на граничарите е копие, а мястото е пълно с хора, но музеят до нея разказва добре историите за бягства.
- **Мауерпарк**: „Паркът на стената" е върху част от някогашната ивица на смъртта. В неделя там има битпазар, а през лятото голямо караоке на открито в амфитеатъра.

В нашия [пътеводител за Берлин](/bg/destinations/berlin) има още за града, а decide може да подреди местата на Стената в план, който има смисъл на картата.`,
  },

  // ---------------------------------------------------------------- Prague
  {
    language: "en",
    slug: "prague-before-the-crowds-wake-up",
    title: "Prague before the crowds wake up",
    excerpt: "Charles Bridge at sunrise, a 600-year-old clock still keeping time, and a beer garden with the best view in town. A morning plan for the most crowded city in Central Europe.",
    destinations: ["Prague"],
    sources: PRAGUE_SOURCES,
    ...cover("prague", "Charles Bridge in Prague seen from the north"),
    body: `By ten in the morning, the heart of Prague belongs to tour groups. Charles Bridge turns into a slow-moving queue and the Old Town Square fills up for the clock. But Prague is a city of early risers, and if you join them you get a very different place.

## Sunrise on Charles Bridge

Charles Bridge has crossed the Vltava since the 14th century, and 30 statues of saints line its sides. Most are copies now, with the originals kept safe in a museum, but in the soft light before seven, with mist on the river and the castle above you, nobody minds.

Walk it from the Old Town side towards the castle, then turn round at the far end. That is the view in every photo of Prague, and at this hour you will have it almost to yourself.

## The clock that has run for 600 years

The astronomical clock on the Old Town Hall was first recorded in 1410, which makes it one of the oldest working astronomical clocks in the world. Its dials show the position of the sun and moon as well as the time, and every hour the twelve apostles appear in the little windows above.

On the hour, the square below is packed. Come a few minutes after instead: you can stand right in front of it, and the dials are more interesting than the show.

## Climb for the view

- **Letná Park**: on the hill across the river, with a beer garden under chestnut trees and a view down onto the bridges. Locals' favourite for a reason.
- **Petřín Hill**: take the funicular up and climb the lookout tower, which looks a lot like a small Eiffel Tower and was built in 1891.

## Where Prague goes to be quiet

Vyšehrad, the old fortress on a rock above the river south of the centre, is where Prague comes to walk. Its cemetery is the resting place of the composer Antonín Dvořák and many of the country's great names, and the view upriver to the castle is one of the best in the city.

Our [Prague guide](/destinations/prague) has more, and decide can build a full day that starts early and avoids the crowds.`,
  },
  {
    language: "bg",
    slug: "praga-predi-talpite-da-se-sabudyat",
    title: "Прага, преди тълпите да се събудят",
    excerpt: "Карловият мост по изгрев, часовник на 600 години, който още върви, и бирена градина с най-хубавата гледка в града. Сутрешен план за най-претъпкания град в Централна Европа.",
    destinations: ["Прага"],
    sources: PRAGUE_SOURCES,
    ...cover("prague", "Карловият мост в Прага, гледан от север"),
    body: `До десет сутринта сърцето на Прага вече принадлежи на организираните групи. Карловият мост се превръща в бавно движеща се опашка, а Староместкият площад се пълни заради часовника. Но Прага е град на ранобудни хора и ако се присъединиш към тях, ще видиш съвсем различно място.

## Изгрев на Карловия мост

Карловият мост пресича Вълтава от XIV век, а покрай него се редят 30 статуи на светци. Повечето вече са копия, а оригиналите се пазят в музей, но на меката светлина преди седем, с мъгла над реката и замъка над теб, на никого не му пречи.

Мини по него от Стария град към замъка и се обърни в другия край. Това е гледката от всяка снимка на Прага и по това време ще я имаш почти само за себе си.

## Часовникът, който върви от 600 години

Астрономическият часовник на Староместкото кметство е споменат за първи път през 1410 г., което го прави един от най-старите работещи астрономически часовници в света. Циферблатите му показват положението на слънцето и луната, а не само часа, и всеки час дванадесетте апостоли се появяват в прозорчетата над тях.

Точно в кръглия час площадът под него е претъпкан. Ела няколко минути след това: ще застанеш точно пред него, а и циферблатите са по-интересни от представлението.

## Изкачи се заради гледката

- **Парк Летна**: на хълма отвъд реката, с бирена градина под кестени и гледка надолу към мостовете. Любимо място на местните, и с причина.
- **Хълмът Петршин**: качи се с фуникуляра и изкачи наблюдателната кула, която прилича на малка Айфелова кула и е построена през 1891 г.

## Където Прага отива за тишина

Вишеград, старата крепост на скала над реката южно от центъра, е мястото, където Прага излиза на разходка. В гробището му почиват композиторът Антонин Дворжак и много от големите имена на страната, а гледката нагоре по реката към замъка е сред най-хубавите в града.

В нашия [пътеводител за Прага](/bg/destinations/prague) има още, а decide може да подреди цял ден, който започва рано и минава покрай тълпите.`,
  },
];

/** Saves and publishes each starter post not already there. A post with the
 * same address (published, or kept as a draft) is left as it is, so the
 * button can be pressed again safely and never overwrites an edit. */
export async function addStarterPosts(db: Queryable): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (const post of STARTER_POSTS) {
    if (await getPublishedPost(db, post.language, post.slug)) {
      skipped++;
      continue;
    }
    const saved = await savePost(db, post);
    if (!saved.ok) {
      skipped++;
      continue;
    }
    await setPostStatus(db, saved.id, "published");
    added++;
  }
  return { added, skipped };
}
