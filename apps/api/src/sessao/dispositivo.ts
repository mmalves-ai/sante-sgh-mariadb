// W1-01 (parte 8): o dispositivo da entrada para "Minhas sessões": só navegador e sistema, resumidos do User-Agent
// ("Chrome no Windows"). Nada de versão completa nem do texto bruto (o cabeçalho é do cliente e pode trazer qualquer
// coisa).
const NAVEGADORES: readonly [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SISTEMAS: readonly [RegExp, string][] = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

export function descreverDispositivo(ua: string | string[] | undefined): string | undefined {
  const texto = (Array.isArray(ua) ? ua[0] : ua)?.slice(0, 512);
  if (!texto) return undefined;
  const nav = NAVEGADORES.find(([re]) => re.test(texto))?.[1];
  const so = SISTEMAS.find(([re]) => re.test(texto))?.[1];
  if (nav && so) return `${nav} no ${so}`;
  return nav ?? so ?? 'Outro dispositivo';
}
