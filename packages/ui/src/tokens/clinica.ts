// Paleta clínica (cap-03 §3.3 e §3.4): as 5 cores da classificação de risco e os 8 estados de leito.
// Não seguem a marca nem o tema: no escuro só se reajusta o contraste, sem mudar o significado.
// Toda entrada tem rótulo (chave i18n) e ícone: cor nunca é a única informação.
import type { NomeIcone } from '../icones/caminhos.js';

export type GrupoClinico = 'risco' | 'leito';

export interface EntradaClinica {
  readonly id: string;
  readonly grupo: GrupoClinico;
  /** Chave i18n do rótulo (ui.clinica.<id>). */
  readonly rotulo: string;
  readonly icone: NomeIcone;
  readonly claro: { readonly fundo: string; readonly texto: string };
  readonly escuro: { readonly fundo: string; readonly texto: string };
}

const BRANCO = '#ffffff';
const PRETO = '#000000';

export const PALETA_CLINICA: readonly EntradaClinica[] = [
  // Classificação de risco (vermelho, laranja, amarelo, verde, azul), na ordem do protocolo.
  {
    id: 'risco-vermelho',
    grupo: 'risco',
    rotulo: 'ui.clinica.risco-vermelho',
    icone: 'emergencia',
    claro: { fundo: '#c62828', texto: BRANCO },
    escuro: { fundo: '#e57373', texto: PRETO },
  },
  {
    id: 'risco-laranja',
    grupo: 'risco',
    rotulo: 'ui.clinica.risco-laranja',
    icone: 'alerta',
    claro: { fundo: '#e65100', texto: PRETO },
    escuro: { fundo: '#ff8a50', texto: PRETO },
  },
  {
    id: 'risco-amarelo',
    grupo: 'risco',
    rotulo: 'ui.clinica.risco-amarelo',
    icone: 'relogio',
    claro: { fundo: '#fdd835', texto: PRETO },
    escuro: { fundo: '#fdd835', texto: PRETO },
  },
  {
    id: 'risco-verde',
    grupo: 'risco',
    rotulo: 'ui.clinica.risco-verde',
    icone: 'info',
    claro: { fundo: '#2e7d32', texto: BRANCO },
    escuro: { fundo: '#66bb6a', texto: PRETO },
  },
  {
    id: 'risco-azul',
    grupo: 'risco',
    rotulo: 'ui.clinica.risco-azul',
    icone: 'check',
    claro: { fundo: '#1565c0', texto: BRANCO },
    escuro: { fundo: '#64b5f6', texto: PRETO },
  },
  // Estados de leito.
  {
    id: 'leito-livre',
    grupo: 'leito',
    rotulo: 'ui.clinica.leito-livre',
    icone: 'check',
    claro: { fundo: '#2e7d32', texto: BRANCO },
    escuro: { fundo: '#66bb6a', texto: PRETO },
  },
  {
    id: 'leito-ocupado',
    grupo: 'leito',
    rotulo: 'ui.clinica.leito-ocupado',
    icone: 'pessoa',
    claro: { fundo: '#1565c0', texto: BRANCO },
    escuro: { fundo: '#64b5f6', texto: PRETO },
  },
  {
    id: 'leito-reservado',
    grupo: 'leito',
    rotulo: 'ui.clinica.leito-reservado',
    icone: 'reservado',
    claro: { fundo: '#6a1b9a', texto: BRANCO },
    escuro: { fundo: '#ce93d8', texto: PRETO },
  },
  {
    id: 'leito-alta-prevista',
    grupo: 'leito',
    rotulo: 'ui.clinica.leito-alta-prevista',
    icone: 'calendario',
    claro: { fundo: '#f9a825', texto: PRETO },
    escuro: { fundo: '#f9a825', texto: PRETO },
  },
  {
    id: 'leito-alta-dada',
    grupo: 'leito',
    rotulo: 'ui.clinica.leito-alta-dada',
    icone: 'saida',
    claro: { fundo: '#e65100', texto: PRETO },
    escuro: { fundo: '#ff8a50', texto: PRETO },
  },
  {
    id: 'leito-higienizacao',
    grupo: 'leito',
    rotulo: 'ui.clinica.leito-higienizacao',
    icone: 'limpeza',
    claro: { fundo: '#006b75', texto: BRANCO },
    escuro: { fundo: '#4dd0e1', texto: PRETO },
  },
  {
    id: 'leito-bloqueado',
    grupo: 'leito',
    rotulo: 'ui.clinica.leito-bloqueado',
    icone: 'bloqueado',
    claro: { fundo: '#424242', texto: BRANCO },
    escuro: { fundo: '#9e9e9e', texto: PRETO },
  },
  {
    id: 'leito-extra',
    grupo: 'leito',
    rotulo: 'ui.clinica.leito-extra',
    icone: 'mais',
    claro: { fundo: '#ad1457', texto: BRANCO },
    escuro: { fundo: '#f06292', texto: PRETO },
  },
];

export type IdClinico = (typeof PALETA_CLINICA)[number]['id'];

export function entradaClinica(id: string): EntradaClinica {
  const e = PALETA_CLINICA.find((x) => x.id === id);
  if (!e) throw new Error(`estado clínico desconhecido: ${id}`);
  return e;
}
