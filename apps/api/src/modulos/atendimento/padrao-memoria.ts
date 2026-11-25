// Valores habituais da abertura do atendimento na porta em memória (desenvolvimento, CI e E2E sintético): o mesmo
// comportamento da porta própria (porta-propria-padrao.ts), com as regras do domínio.
import {
  CAMPOS_PADRAO_ABERTURA,
  type CampoPadraoAbertura,
  type DefinirPadraoAberturaEntrada,
} from '@sgh/contratos';
import { type ItemPadrao, mudancasDoPadrao, type PadraoAbertura } from '@sgh/dominio-atendimento';
import { ErroOperacao, recusa } from '@sgh/nucleo';
import type { PadraoAberturaLido } from './porta-propria-padrao.js';

type Valores = Record<CampoPadraoAbertura, number | null>;
export interface EstadoPadraoAbertura {
  /** Uma linha por escopo: "est" ou "u:<usuário>". */
  readonly linhas: Map<string, { valores: Valores; versao: number }>;
}
export const novoEstadoPadraoAbertura = (): EstadoPadraoAbertura => ({ linhas: new Map() });

/** As listas do apoio: o item fora da lista (ou o convênio suspenso) não vale mais. */
export interface ListasPadrao {
  readonly convenios: readonly { codigo: number; nome: string; ativo: boolean }[];
  readonly unidades: readonly { codigo: number; nome: string }[];
  readonly especialidades: readonly { codigo: number; nome: string }[];
  readonly centrosCusto: readonly { codigo: number; nome: string }[];
}

function item(campo: CampoPadraoAbertura, id: number, l: ListasPadrao): ItemPadrao | null {
  const lista: readonly { codigo: number; nome: string; ativo?: boolean }[] =
    campo === 'convenio'
      ? l.convenios
      : campo === 'unidade'
        ? l.unidades
        : campo === 'especialidade'
          ? l.especialidades
          : l.centrosCusto;
  const x = lista.find((y) => y.codigo === id);
  return x ? { id, rotulo: x.nome, vale: x.ativo !== false } : null;
}

const chave = (usuario: unknown): string => `u:${String(usuario)}`;

export function lerPadraoMemoria(
  s: EstadoPadraoAbertura,
  usuario: unknown,
  l: ListasPadrao,
): PadraoAberturaLido {
  const escopo = (k: string): PadraoAbertura | null => {
    const linha = s.linhas.get(k);
    if (!linha) return null;
    const r: Partial<Record<CampoPadraoAbertura, ItemPadrao | null>> = {};
    for (const { campo } of CAMPOS_PADRAO_ABERTURA) {
      const id = linha.valores[campo];
      r[campo] = id === null ? null : (item(campo, id, l) ?? { id, rotulo: String(id), vale: false });
    }
    return r;
  };
  const temUsuario = usuario !== null && usuario !== undefined;
  return {
    estabelecimento: escopo('est'),
    pessoal: temUsuario ? escopo(chave(usuario)) : null,
    versaoEstabelecimento: s.linhas.get('est')?.versao ?? 0,
    versaoPessoal: temUsuario ? (s.linhas.get(chave(usuario))?.versao ?? 0) : 0,
  };
}

export function definirPadraoMemoria(
  s: EstadoPadraoAbertura,
  pessoal: boolean,
  usuario: unknown,
  e: DefinirPadraoAberturaEntrada,
  l: ListasPadrao,
) {
  if (pessoal && (usuario === null || usuario === undefined))
    throw recusa('usuario-obrigatorio', 'Os valores habituais pessoais exigem o usuário da sessão.');
  const k = pessoal ? chave(usuario) : 'est';
  const linha = s.linhas.get(k);
  if ((linha?.versao ?? 0) !== e.versao)
    throw new ErroOperacao(
      409,
      'conflito-versao',
      'Valores habituais alterados em outra estação',
      'Os valores habituais mudaram desde a leitura. Releia e confira antes de salvar.',
    );
  const atual: Valores = linha?.valores ?? {
    unidade: null,
    centroCusto: null,
    convenio: null,
    especialidade: null,
  };
  const mudancas = mudancasDoPadrao(atual, e.valores);
  if (mudancas.length === 0) throw recusa('nada-a-alterar', 'Nada a alterar.');
  for (const m of mudancas) {
    if (m.depois === null) continue;
    const x = item(m.campo, m.depois, l);
    if (!x?.vale) {
      const rotulo = CAMPOS_PADRAO_ABERTURA.find((c) => c.campo === m.campo)?.rotulo ?? m.campo;
      throw recusa(
        'padrao-invalido',
        `${rotulo}: o item escolhido não existe ou não está em uso neste estabelecimento.`,
      );
    }
  }
  const valores = { ...atual };
  for (const m of mudancas) valores[m.campo] = m.depois;
  const versao = (linha?.versao ?? 0) + 1;
  s.linhas.set(k, { valores, versao });
  return {
    id: 1,
    versao,
    escopo: pessoal ? 'usuario' : 'estabelecimento',
    campos: mudancas.map((m) => m.campo).join(','),
    mudancas: JSON.stringify(mudancas),
  };
}
