// Ícones próprios do @sgh/ui (traço 2 px, grade 24 × 24, cor do texto: `currentColor`).
// Desenho geométrico simples, sem pacote externo.
export const CAMINHOS_ICONES = {
  alerta: 'M12 3 2 21h20L12 3z M12 10v5 M12 18h.01',
  emergencia: 'M8 2h8l6 6v8l-6 6H8l-6-6V8z M12 7v6 M12 16h.01',
  info: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M12 11v6 M12 7h.01',
  check: 'M4 12l5 5L20 6',
  fechar: 'M6 6l12 12M18 6 6 18',
  relogio: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M12 7v5l3 3',
  pessoa: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8z M4 21c0-4 4-6 8-6s8 2 8 6',
  homonimo:
    'M9 11a3 3 0 1 0 0-6a3 3 0 0 0 0 6z M15 11a3 3 0 1 0 0-6 M3 20c0-3 3-5 6-5s6 2 6 5 M17 15c2 .5 4 2 4 5',
  reservado: 'M6 3h12v18l-6-4-6 4z',
  calendario: 'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4',
  saida: 'M10 17l5-5-5-5 M15 12H3 M14 3h6v18h-6',
  limpeza: 'M14 3l-3 9 M6 12h10l2 9H4l2-9z',
  bloqueado: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M5 5l14 14',
  mais: 'M12 5v14M5 12h14',
  busca: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M21 21l-5-5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  // M27: o sino da central de avisos e o envelope das mensagens internas.
  sino: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4z M10 21h4',
  mensagem: 'M3 5h18v14H3z M3 6l9 7 9-7',
  cadeado: 'M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4',
  teclado: 'M3 6h18v12H3z M7 10h.01M11 10h.01M15 10h.01M7 14h10',
  cama: 'M3 7v12 M3 14h18v5 M21 14v-2a3 3 0 0 0-3-3h-7v5 M7 10h.01',
  hospital: 'M4 21V5h16v16 M9 21v-5h6v5 M12 8v5 M9.5 10.5h5',
  sair: 'M15 17l5-5-5-5 M20 12H9 M9 3H4v18h5',
  seta: 'M9 6l6 6-6 6',
} as const;

export type NomeIcone = keyof typeof CAMINHOS_ICONES;
