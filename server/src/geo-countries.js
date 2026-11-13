// Países por continente para el formulario de geobloqueo. La web los recibe desde la API (una sola lista, la del servidor),
// y el servidor solo acepta nombres de esta lista al guardar una respuesta.
const CONTINENTS = [
  ['Sudamérica', ['Argentina', 'Bolivia', 'Brasil', 'Chile', 'Colombia', 'Ecuador', 'Guyana', 'Paraguay', 'Perú', 'Surinam', 'Uruguay', 'Venezuela']],
  ['Norteamérica', ['Canadá', 'Estados Unidos', 'México']],
  ['Centroamérica y Caribe', ['Antigua y Barbuda', 'Bahamas', 'Barbados', 'Belice', 'Costa Rica', 'Cuba', 'Dominica', 'El Salvador', 'Granada', 'Guatemala', 'Haití', 'Honduras', 'Jamaica', 'Nicaragua', 'Panamá', 'República Dominicana', 'San Cristóbal y Nieves', 'San Vicente y las Granadinas', 'Santa Lucía', 'Trinidad y Tobago']],
  ['Europa', ['Albania', 'Alemania', 'Andorra', 'Austria', 'Bélgica', 'Bielorrusia', 'Bosnia y Herzegovina', 'Bulgaria', 'Chipre', 'Ciudad del Vaticano', 'Croacia', 'Dinamarca', 'Eslovaquia', 'Eslovenia', 'España', 'Estonia', 'Finlandia', 'Francia', 'Grecia', 'Hungría', 'Irlanda', 'Islandia', 'Italia', 'Letonia', 'Liechtenstein', 'Lituania', 'Luxemburgo', 'Macedonia del Norte', 'Malta', 'Moldavia', 'Mónaco', 'Montenegro', 'Noruega', 'Países Bajos', 'Polonia', 'Portugal', 'Reino Unido', 'Rumania', 'Rusia', 'San Marino', 'Serbia', 'Suecia', 'Suiza', 'Ucrania']],
  ['Asia', ['Afganistán', 'Arabia Saudita', 'Armenia', 'Azerbaiyán', 'Bangladés', 'Baréin', 'Birmania', 'Brunéi', 'Bután', 'Camboya', 'Catar', 'China', 'Corea del Norte', 'Corea del Sur', 'Emiratos Árabes Unidos', 'Filipinas', 'Georgia', 'India', 'Indonesia', 'Irak', 'Irán', 'Israel', 'Japón', 'Jordania', 'Kazajistán', 'Kirguistán', 'Kuwait', 'Laos', 'Líbano', 'Malasia', 'Maldivas', 'Mongolia', 'Nepal', 'Omán', 'Pakistán', 'Singapur', 'Siria', 'Sri Lanka', 'Tailandia', 'Taiwán', 'Tayikistán', 'Timor Oriental', 'Turkmenistán', 'Turquía', 'Uzbekistán', 'Vietnam', 'Yemen']],
  ['África', ['Angola', 'Argelia', 'Benín', 'Botsuana', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Camerún', 'Chad', 'Comoras', 'Congo', 'Costa de Marfil', 'Egipto', 'Eritrea', 'Esuatini', 'Etiopía', 'Gabón', 'Gambia', 'Ghana', 'Guinea', 'Guinea Ecuatorial', 'Guinea-Bisáu', 'Kenia', 'Lesoto', 'Liberia', 'Libia', 'Madagascar', 'Malaui', 'Malí', 'Marruecos', 'Mauricio', 'Mauritania', 'Mozambique', 'Namibia', 'Níger', 'Nigeria', 'República Centroafricana', 'República Democrática del Congo', 'Ruanda', 'Santo Tomé y Príncipe', 'Senegal', 'Seychelles', 'Sierra Leona', 'Somalia', 'Sudáfrica', 'Sudán', 'Sudán del Sur', 'Tanzania', 'Togo', 'Túnez', 'Uganda', 'Yibuti', 'Zambia', 'Zimbabue']],
  ['Oceanía', ['Australia', 'Fiyi', 'Islas Marshall', 'Islas Salomón', 'Kiribati', 'Micronesia', 'Nauru', 'Nueva Zelanda', 'Palaos', 'Papúa Nueva Guinea', 'Samoa', 'Tonga', 'Tuvalu', 'Vanuatu']],
];

// Marcados de entrada cuando el cliente abre el formulario por primera vez
const RECOMMENDED = ['Perú', 'Estados Unidos', 'Canadá', 'Reino Unido'];

const catalog = CONTINENTS.map(([name, countries]) => ({ name, countries: [...countries].sort((a, b) => a.localeCompare(b, 'es')) }));
const ALL = new Set(catalog.flatMap((c) => c.countries));

module.exports = { catalog, RECOMMENDED, TOTAL: ALL.size, isCountry: (name) => ALL.has(name) };
