// Tokens de cor do Sante SGH (cap-03 §3.3). ÚNICO lugar com cor em hexadecimal fora dos SVGs de marca:
// o stylelint e o teste tokens.spec.ts recusam cor solta no resto do código.
import { palette } from '@openvue/themes';

export interface CoresDaMarca {
  /** Primária (vinho na Rede Santé): botão principal, cabeçalho, links, seleção, foco. */
  readonly corPrimaria: string;
  /** Secundária (cinza na Rede Santé): bordas, divisores, ícones decorativos. Nunca texto no tema claro. */
  readonly corSecundaria: string;
}

export type Escala = Readonly<
  Record<'50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950', string>
>;

export function escala(cor: string): Escala {
  return palette(cor) as unknown as Escala;
}

/** Nomes dos tokens semânticos (viram variáveis CSS --sgh-<nome>). */
export const NOMES_TOKENS = [
  'fundo',
  'fundo-elevado',
  'fundo-sutil',
  'borda',
  'borda-forte',
  'texto',
  'texto-secundario',
  'texto-inverso',
  'primaria',
  'primaria-hover',
  'primaria-texto',
  'primaria-suave',
  'foco',
  'link',
  'alerta',
  'alerta-texto',
  'alerta-suave',
  'aviso',
  'aviso-suave',
  'sucesso',
  'info',
  'sobreposicao',
] as const;
export type NomeToken = (typeof NOMES_TOKENS)[number];
export type TokensDeTema = Readonly<Record<NomeToken, string>>;

/** Cores clínicas: paleta própria, separada da marca (vinho não é alerta). */
export const CLINICA = {
  claro: {
    alerta: '#d40000',
    alertaTexto: '#ffffff',
    alertaSuave: '#fdecec',
    aviso: '#a15c00',
    avisoSuave: '#fff4e0',
    sucesso: '#2e7d32',
    info: '#1565c0',
  },
  escuro: {
    alerta: '#ff7a7a',
    alertaTexto: '#1b1b1c',
    alertaSuave: '#3a1f1f',
    aviso: '#f0b45a',
    avisoSuave: '#3a2e1a',
    sucesso: '#81c784',
    info: '#90caf9',
  },
} as const;

export const BRANCO = '#ffffff';

/** Fundo do tema escuro: o 950 da secundária escurecido (estação de UTI, luz baixa). */
const FUNDO_ESCURO = '#1b1b1c';

export function tokensDoTema(marca: CoresDaMarca): {
  readonly claro: TokensDeTema;
  readonly escuro: TokensDeTema;
} {
  const p = escala(marca.corPrimaria);
  const s = escala(marca.corSecundaria);
  const claro: TokensDeTema = {
    fundo: BRANCO,
    'fundo-elevado': BRANCO,
    'fundo-sutil': s['50'],
    borda: marca.corSecundaria,
    'borda-forte': s['600'],
    texto: s['950'],
    // Texto secundário: cinza derivado da secundária, com 4,5:1 ou mais (a secundária pura não serve).
    'texto-secundario': s['700'],
    'texto-inverso': BRANCO,
    primaria: marca.corPrimaria,
    'primaria-hover': p['600'],
    'primaria-texto': BRANCO,
    'primaria-suave': p['50'],
    foco: marca.corPrimaria,
    link: marca.corPrimaria,
    alerta: CLINICA.claro.alerta,
    'alerta-texto': CLINICA.claro.alertaTexto,
    'alerta-suave': CLINICA.claro.alertaSuave,
    aviso: CLINICA.claro.aviso,
    'aviso-suave': CLINICA.claro.avisoSuave,
    sucesso: CLINICA.claro.sucesso,
    info: CLINICA.claro.info,
    sobreposicao: '#262627b3',
  };
  const escuro: TokensDeTema = {
    fundo: FUNDO_ESCURO,
    'fundo-elevado': s['950'],
    'fundo-sutil': s['950'],
    borda: s['700'],
    'borda-forte': s['500'],
    texto: s['50'],
    // No escuro, o cinza da marca tem contraste suficiente para texto secundário (cap-03 §3.3).
    'texto-secundario': marca.corSecundaria,
    'texto-inverso': FUNDO_ESCURO,
    // Primária no escuro: tom claro do vinho.
    primaria: p['100'],
    'primaria-hover': p['50'],
    'primaria-texto': s['950'],
    'primaria-suave': p['900'],
    foco: p['100'],
    link: p['100'],
    alerta: CLINICA.escuro.alerta,
    'alerta-texto': CLINICA.escuro.alertaTexto,
    'alerta-suave': CLINICA.escuro.alertaSuave,
    aviso: CLINICA.escuro.aviso,
    'aviso-suave': CLINICA.escuro.avisoSuave,
    sucesso: CLINICA.escuro.sucesso,
    info: CLINICA.escuro.info,
    sobreposicao: '#000000b3',
  };
  return { claro, escuro };
}

/** Pares texto × fundo declarados, com o mínimo WCAG 2.2 AA de cada um (relatório de contraste). */
export const PARES_DE_CONTRASTE: readonly {
  texto: NomeToken;
  fundo: NomeToken;
  minimo: number;
  uso: string;
}[] = [
  { texto: 'texto', fundo: 'fundo', minimo: 4.5, uso: 'texto normal' },
  { texto: 'texto', fundo: 'fundo-elevado', minimo: 4.5, uso: 'texto em cartão' },
  { texto: 'texto', fundo: 'fundo-sutil', minimo: 4.5, uso: 'texto em área de apoio' },
  { texto: 'texto-secundario', fundo: 'fundo', minimo: 4.5, uso: 'rótulos e legendas' },
  { texto: 'texto-secundario', fundo: 'fundo-elevado', minimo: 4.5, uso: 'rótulos em cartão' },
  { texto: 'texto-secundario', fundo: 'fundo-sutil', minimo: 4.5, uso: 'rótulos em área de apoio' },
  { texto: 'primaria', fundo: 'fundo', minimo: 4.5, uso: 'link e texto na primária' },
  { texto: 'primaria', fundo: 'fundo-elevado', minimo: 4.5, uso: 'link em cartão' },
  { texto: 'primaria-texto', fundo: 'primaria', minimo: 4.5, uso: 'texto do botão principal' },
  { texto: 'primaria-texto', fundo: 'primaria-hover', minimo: 4.5, uso: 'botão principal sob o ponteiro' },
  { texto: 'texto', fundo: 'primaria-suave', minimo: 4.5, uso: 'item selecionado' },
  { texto: 'foco', fundo: 'fundo', minimo: 3, uso: 'contorno de foco' },
  { texto: 'borda-forte', fundo: 'fundo', minimo: 3, uso: 'borda de campo e componente' },
  { texto: 'alerta', fundo: 'fundo', minimo: 4.5, uso: 'texto de alerta clínico' },
  { texto: 'alerta', fundo: 'fundo-elevado', minimo: 4.5, uso: 'alerta em cartão' },
  { texto: 'alerta-texto', fundo: 'alerta', minimo: 4.5, uso: 'selo de alerta cheio' },
  { texto: 'texto', fundo: 'alerta-suave', minimo: 4.5, uso: 'faixa de alerta' },
  { texto: 'aviso', fundo: 'fundo', minimo: 4.5, uso: 'texto de aviso' },
  { texto: 'texto', fundo: 'aviso-suave', minimo: 4.5, uso: 'faixa de aviso' },
  { texto: 'sucesso', fundo: 'fundo', minimo: 4.5, uso: 'texto de sucesso' },
  { texto: 'info', fundo: 'fundo', minimo: 4.5, uso: 'texto informativo' },
  { texto: 'link', fundo: 'fundo', minimo: 4.5, uso: 'link' },
];
