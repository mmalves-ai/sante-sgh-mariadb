// Regra de alerta administrativo na tela (01-ADM L75): o formulário, a conferência feita enquanto se digita (a MESMA
// regra do servidor, `validarRegraAlerta` do domínio) e o corpo da gravação. Editar parte da regra LIDA inteira: o que
// a tela não muda volta como veio, então ativar, desativar ou trocar destinatário não altera o conteúdo por engano.
// Funções puras, sem rede.
import {
  MENSAGEM_NOTIFICACAO,
  type RecusaNotificacao,
  validarRegraAlerta,
} from '@sgh/dominio-acesso/autorizacao';
import type { PainelNotificacao } from './api-notificacao-regras.js';

export type RegraLida = PainelNotificacao['regras'][number];
export const GRAVIDADES = ['informativo', 'atencao', 'critico'] as const;
export const REPETICOES = ['sempre', 'uma_vez', 'por_atendimento', 'intervalo'] as const;
export const SEXOS = ['todos', 'feminino', 'masculino'] as const;
export const CANAIS = ['tela', 'email', 'sms', 'aplicativo'] as const;
export type Canal = (typeof CANAIS)[number];

export interface FormRegra {
  id: number | null;
  versao: number | null;
  codigo: string;
  nome: string;
  cenario: string;
  descricao: string;
  mensagem: string;
  gravidade: string;
  bloqueante: boolean;
  exigeJustificativa: boolean;
  sexo: string;
  idadeMinima: string;
  idadeMaxima: string;
  repeticao: string;
  intervaloMinutos: string;
  canais: Record<Canal, boolean>;
  consolidacao: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  ativo: boolean;
  motivo: string;
  perfis: string[];
  usuarios: string[];
}

/** Regra nova: vigência a partir de hoje, aviso na central, ativa. */
export function formNovo(hoje: string, cenario = ''): FormRegra {
  return {
    id: null,
    versao: null,
    codigo: '',
    nome: '',
    cenario,
    descricao: '',
    mensagem: '',
    gravidade: 'atencao',
    bloqueante: false,
    exigeJustificativa: false,
    sexo: 'todos',
    idadeMinima: '',
    idadeMaxima: '',
    repeticao: 'sempre',
    intervaloMinutos: '',
    canais: { tela: true, email: false, sms: false, aplicativo: false },
    consolidacao: '',
    vigenciaInicio: hoje,
    vigenciaFim: '',
    ativo: true,
    motivo: '',
    perfis: [],
    usuarios: [],
  };
}

const texto = (n: number | null): string => (n === null ? '' : String(n));

export function formDaRegra(r: RegraLida): FormRegra {
  return {
    id: r.id,
    versao: r.versao,
    codigo: r.codigo,
    nome: r.nome,
    cenario: r.cenario,
    descricao: r.descricao ?? '',
    mensagem: r.mensagem,
    gravidade: r.gravidade,
    bloqueante: r.bloqueante,
    exigeJustificativa: r.exigeJustificativa,
    sexo: r.sexo,
    idadeMinima: texto(r.idadeMinima),
    idadeMaxima: texto(r.idadeMaxima),
    repeticao: r.repeticao,
    intervaloMinutos: texto(r.intervaloMinutos),
    canais: { ...r.notifica },
    consolidacao: r.consolidacao ?? '',
    vigenciaInicio: r.vigenciaInicio ?? '',
    vigenciaFim: r.vigenciaFim ?? '',
    ativo: r.ativo,
    motivo: '',
    perfis: r.destinatarios.filter((d) => d.tipo === 'perfil').map((d) => d.codigo),
    usuarios: r.destinatarios.filter((d) => d.tipo === 'usuario').map((d) => d.codigo),
  };
}

/** Inteiro não negativo digitado, ou nulo se vazio; `NaN` quando não é número inteiro. */
function inteiro(s: string): number | null {
  const v = s.trim();
  if (v === '') return null;
  return /^\d{1,6}$/.test(v) ? Number(v) : Number.NaN;
}

export type FalhaRegra = RecusaNotificacao | 'cenario-vazio' | 'numero-invalido' | 'vigencia-vazia';

export const MENSAGEM_FALHA_REGRA: Readonly<Record<FalhaRegra, string>> = {
  ...MENSAGEM_NOTIFICACAO,
  'codigo-invalido': 'O código usa letras, números, ponto, hífen ou sublinhado (até 60), sem espaço.',
  'cenario-vazio': 'Escolha onde o alerta dispara.',
  'numero-invalido': 'Idade e intervalo são números inteiros.',
  'vigencia-vazia': 'Informe o início da vigência.',
};

/** O que impede gravar agora (nulo: pode gravar). A ordem é a do formulário, de cima para baixo. */
export function conferirRegra(f: FormRegra): FalhaRegra | null {
  const min = inteiro(f.idadeMinima);
  const max = inteiro(f.idadeMaxima);
  const intervalo = inteiro(f.intervaloMinutos);
  if ([min, max, intervalo].some((n) => Number.isNaN(n))) return 'numero-invalido';
  const base = {
    codigo: f.codigo.trim(),
    nome: f.nome,
    mensagem: f.mensagem,
    idadeMinima: min,
    idadeMaxima: max,
    vigenciaInicio: f.vigenciaInicio,
    vigenciaFim: f.vigenciaFim || null,
    repeticao: f.repeticao,
    intervaloMinutos: intervalo,
    ativo: f.ativo,
    destinatarios: destinatariosDoForm(f).length,
  };
  // Primeiro o conteúdo (código, nome), depois o cenário e a vigência, por fim o resto da regra do domínio.
  const conteudo = validarRegraAlerta({ ...base, ativo: false, vigenciaFim: null, repeticao: 'sempre' });
  if (conteudo === 'codigo-invalido' || conteudo === 'nome-vazio') return conteudo;
  if (f.cenario === '') return 'cenario-vazio';
  if (conteudo) return conteudo;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.vigenciaInicio)) return 'vigencia-vazia';
  return validarRegraAlerta(base);
}

export function destinatariosDoForm(f: FormRegra): { tipo: 'usuario' | 'perfil'; codigo: string }[] {
  const unicos = (l: readonly string[]) => [...new Set(l.map((x) => x.trim()).filter((x) => x !== ''))];
  return [
    ...unicos(f.perfis).map((codigo) => ({ tipo: 'perfil' as const, codigo })),
    ...unicos(f.usuarios).map((codigo) => ({ tipo: 'usuario' as const, codigo })),
  ];
}

/** Inclui o login digitado (em maiúsculas, sem repetir); devolve a lista nova ou nulo se o login não serve. */
export function incluirUsuario(lista: readonly string[], digitado: string): string[] | null {
  const login = digitado.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,60}$/.test(login)) return null;
  return lista.includes(login) ? [...lista] : [...lista, login];
}

/** Corpo de POST /administracao/notificacao-regras/regras-alerta (o esquema do servidor é estrito). */
export function corpoDaRegra(f: FormRegra): Record<string, unknown> {
  const motivo = f.motivo.trim();
  return {
    ...(f.id !== null && f.versao !== null ? { id: f.id, versao: f.versao } : {}),
    codigo: f.codigo.trim(),
    nome: f.nome.trim(),
    cenario: f.cenario,
    descricao: f.descricao.trim() === '' ? null : f.descricao.trim(),
    mensagem: f.mensagem.trim(),
    gravidade: f.gravidade,
    bloqueante: f.bloqueante,
    exigeJustificativa: f.exigeJustificativa,
    sexo: f.sexo,
    idadeMinima: inteiro(f.idadeMinima),
    idadeMaxima: inteiro(f.idadeMaxima),
    repeticao: f.repeticao,
    intervaloMinutos: f.repeticao === 'intervalo' ? inteiro(f.intervaloMinutos) : null,
    notificaTela: f.canais.tela,
    notificaEmail: f.canais.email,
    notificaSms: f.canais.sms,
    notificaAplicativo: f.canais.aplicativo,
    consolidacao: f.consolidacao === '' ? null : f.consolidacao,
    vigenciaInicio: f.vigenciaInicio,
    vigenciaFim: f.vigenciaFim === '' ? null : f.vigenciaFim,
    ativo: f.ativo,
    ...(f.id !== null && motivo !== '' ? { motivo } : {}),
    destinatarios: destinatariosDoForm(f),
  };
}

/** Ativar ou desativar na linha: a regra como foi lida, só com a situação trocada. */
export function corpoDaSituacao(r: RegraLida, ativo: boolean): Record<string, unknown> {
  return corpoDaRegra({ ...formDaRegra(r), ativo });
}
