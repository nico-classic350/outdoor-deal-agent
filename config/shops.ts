import { ShopSource } from '../lib/types';

const DATA = `bergfreunde|Bergfreunde|DE|https://www.bergfreunde.de|1
bergzeit|Bergzeit|DE|https://www.bergzeit.de|1
globetrotter|Globetrotter|DE|https://www.globetrotter.de|1
sport-conrad|Sport Conrad|DE|https://www.sport-conrad.com|1
sport-schuster|Sport Schuster|DE|https://www.sport-schuster.de|1
sport-bittl|Sport Bittl|DE|https://www.sport-bittl.com|1
sportscheck|SportScheck|DE|https://www.sportscheck.com|1
sportfits|SportFits|DE|https://www.sportfits.de|1
sportokay|SportOkay|AT|https://www.sportokay.com|1
outdoor-renner|Outdoor Renner|DE|https://www.outdoor-renner.de|1
unterwegs|Unterwegs|DE|https://www.unterwegs.biz|1
doorout|Doorout|DE|https://www.doorout.com|1
verticalextreme|VerticalExtreme|DE|https://www.verticalextreme.de|1
tapir|Tapir Store|DE|https://www.tapir-store.de|2
camp4|CAMP4|DE|https://www.camp4.de|2
trekking-koenig|Trekking König|DE|https://www.trekking-koenig.de|2
sport65|Sport65|DE|https://www.sport65.de|2
engelhorn|Engelhorn Sports|DE|https://www.engelhorn.de|2
breuninger|Breuninger|DE|https://www.breuninger.com|2
intersport-de|Intersport Deutschland|DE|https://www.intersport.de|2
decathlon-de|Decathlon Deutschland|DE|https://www.decathlon.de|3
sportspar|Sportspar|DE|https://www.sportspar.de|3
sportdeal24|Sportdeal24|DE|https://www.sportdeal24.de|3
gigasport|Gigasport|AT|https://www.gigasport.at|1
hervis|Hervis|AT|https://www.hervis.at|2
blue-tomato|Blue Tomato|AT|https://www.blue-tomato.com|2
snowleader|Snowleader|FR|https://www.snowleader.com|1
ekosport|Ekosport|FR|https://www.ekosport.eu|1
hardloop|Hardloop|FR|https://www.hardloop.de|1
alpinstore|Alpinstore|FR|https://www.alpinstore.com|2
speck-sports|Speck Sports|FR|https://www.speck-sports.com|2
chullanka|Chullanka|FR|https://www.chullanka.com|2
vieux-campeur|Au Vieux Campeur|FR|https://www.auvieuxcampeur.fr|2
trekkinn|Trekkinn|ES|https://www.tradeinn.com/trekkinn|2
snowinn|Snowinn|ES|https://www.tradeinn.com/snowinn|2
barrabes|Barrabes|ES|https://www.barrabes.com|1
scandinavian-outdoor|Scandinavian Outdoor|FI|https://scandinavianoutdoor.com|1
varuste|Varuste|FI|https://varuste.net|1
sportano|Sportano|PL|https://sportano.com|2
8a|8a|PL|https://8a.pl|1
4camping|4camping|CZ|https://www.4camping.cz|2
hudy|HUDY|CZ|https://www.hudy.cz|1
hanibal|Hanibal|CZ|https://www.hanibal.cz|2
rockpoint|Rock Point|CZ|https://www.rockpoint.cz|2
e-horyzont|e-Horyzont|PL|https://www.e-horyzont.pl|2
sportler|Sportler|IT|https://www.sportler.com|1
oliunid|Oliunìd|IT|https://www.oliunid.com|2
df-sport|DF Sport Specialist|IT|https://www.df-sportspecialist.it|2
nencini|Nencini Sport|IT|https://www.nencinisport.it|2
maxisport|Maxi Sport|IT|https://www.maxisport.com|2
bottero|Bottero Ski|IT|https://www.botteroski.com|2
sportit|SportIT|IT|https://www.sportit.com|2
cisalfa|Cisalfa Sport|IT|https://www.cisalfasport.it|2
privatesportshop|Private Sport Shop|FR|https://www.privatesportshop.com|2
snowcountry|Snowcountry|NL|https://www.snowcountry.eu|1
bever|Bever|NL|https://www.bever.nl|2
asadventure|A.S.Adventure|BE|https://www.asadventure.com|2
vrijbuiter|Vrijbuiter|NL|https://www.vrijbuiter.nl|3
zalando-de|Zalando DE|DE|https://www.zalando.de|2
aboutyou-de|ABOUT YOU DE|DE|https://www.aboutyou.de|2
bestsecret|BestSecret|DE|https://www.bestsecret.com|2
limango|Limango|DE|https://www.limango.de|3
galeria|GALERIA|DE|https://www.galeria.de|3
yoox|YOOX EU|IT|https://www.yoox.com|3
farfetch|Farfetch EU|PT|https://www.farfetch.com|3
amazon-de|Amazon DE|DE|https://www.amazon.de|3
ebay-de|eBay DE New|DE|https://www.ebay.de|3
arcteryx-eu|Arc’teryx EU|NL|https://arcteryx.com|1
odlo-eu|Odlo EU|DE|https://www.odlo.com|1
dynafit-eu|Dynafit EU|IT|https://www.dynafit.com|1
ortovox-eu|Ortovox EU|DE|https://www.ortovox.com|1
lasportiva-eu|La Sportiva EU|IT|https://www.lasportiva.com|1
mammut-eu|Mammut EU|DE|https://www.mammut.com|1
patagonia-eu|Patagonia EU|NL|https://eu.patagonia.com|1
rab-eu|Rab EU|NL|https://rab.equipment/eu|1
norrona-eu|Norrøna EU|SE|https://www.norrona.com|1
haglofs-eu|Haglöfs EU|SE|https://www.haglofs.com|1
blackdiamond-eu|Black Diamond EU|AT|https://www.blackdiamondequipment.com|1
peakperformance-eu|Peak Performance EU|SE|https://www.peakperformance.com|1
houdini-eu|Houdini EU|SE|https://houdinisportswear.com|1
adidas-terrex-de|Adidas Terrex DE|DE|https://www.adidas.de/terrex|1
goldwin-eu|Goldwin Europe|DE|https://www.goldwin-global.com/eu|2
tilak-eu|Tilak EU|CZ|https://www.tilak.com|2
66north-eu|66°North EU|DK|https://www.66north.com|2
foerg|Sport Förg|DE|https://foerg.de|1
biwak|Biwak Outdoor-Shop|DE|https://www.biwak.com|2
feinbier|Feinbier unterwegs|DE|https://www.feinbier-unterwegs.de|2
biwakschachtel|Biwakschachtel Tübingen|DE|https://www.biwakschachtel-tuebingen.de|2
carl-denig|Carl Denig|NL|https://www.carldenig.nl|2
glisshop|Glisshop|FR|https://www.glisshop.com|2
outnorth|Outnorth|SE|https://www.outnorth.com|2`;

export const SHOPS: ShopSource[] = DATA.split('\n').map((line) => {
  const [id, name, country, baseUrl, priority] = line.split('|');
  return { id, name, country, baseUrl, priority: Number(priority) as 1|2|3 };
});
