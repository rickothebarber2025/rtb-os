import { parseBooksyEmail } from './supabase/functions/_shared/booksy-parser.js';

const body = "https://booksy.com/biz/en-ca/ -\n\nEmmanuel Ekon: new booking\n\nEmmanuel Ekon\n\n(613) 807-7012\n\n mailto:christemmanuel.ekon@gmail.com - christemmanuel.ekon@gmail.com\n\nSunday, July 26, 2026, 3:00 p.m. - 5:30 p.m.\n\n\tHAIRSTYLIST SERVICE: LOC RETWIST (Palm Roll, Comb Twist)\n\n$80.00+,\n\n                        3:00 p.m. - 5:30 p.m.\n\nwith\n\n                        TK | HAIRSTYLIST\n\nA note from the business:\n\nPlease arrive on time for your appointment.";
const subject = "Emmanuel Ekon: new booking Sunday, July 26, 2026 3:00 p.m.";

const result = parseBooksyEmail({ body, subject, headers: {}, messageId: 'test', threadId: 'test' });
console.log(JSON.stringify(result, null, 2));
