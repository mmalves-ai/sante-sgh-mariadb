// Ícone de cada área do menu (SVG 24x24 de traço, como o SanteIcone do @sgh/ui, que não traz ícones de área).
// Mapeamento único: área nova sem ícone usa o genérico. Decorativos: o nome da área sempre vem ao lado.

const GENERICO = 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z';

export const ICONES_DE_AREA: Readonly<Record<string, string>> = {
  INÍCIO: 'M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5',
  'ATENDIMENTO AO PACIENTE': 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  ASSISTÊNCIA:
    'M20.8 8.6a5 5 0 0 0-8.8-3.2 5 5 0 0 0-8.8 3.2C3 13 7.5 16.8 12 21c4.5-4.2 9-8 8.8-12.4zM3.5 12H8l2-3 3 5 2-2h5.5',
  DIAGNÓSTICO: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9',
  SUPRIMENTOS: 'M21 7.5l-9-5-9 5v9l9 5 9-5zM3 7.5l9 5 9-5M12 12.5V21.5',
  FATURAMENTO: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  FINANCEIRO: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  'HOTELARIA E APOIO': 'M2 18h20M4 18a8 8 0 0 1 16 0M12 10V7M10 7h4',
  'QUALIDADE E SEGURANÇA': 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5zM9 12l2 2 4-4',
  'GESTÃO DE PESSOAS':
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7M18.5 14.5A7 7 0 0 1 22 21',
  CONTROLADORIA: 'M5 2h14v20H5zM8 6h8v4H8zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01',
  'RELATÓRIOS E BI': 'M3 3v18h18M8 17v-5M13 17V8M18 17v-9',
  PORTAIS: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z',
  CADASTROS: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 13h8',
  ADMINISTRAÇÃO: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  TÉCNICO:
    'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
};

export function iconeDaArea(area: string): string {
  return ICONES_DE_AREA[area] ?? GENERICO;
}

/** Seta dos níveis (aponta para a direita; gira 90 graus quando aberto). */
export const SETA = 'M9 6l6 6-6 6';
