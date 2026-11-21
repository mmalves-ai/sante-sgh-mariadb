// Trilha própria do cliente (F2-L): os eventos auditáveis da API (login, falha, bloqueio, fim de sessão, @Auditar) vão à
// trilha_auditoria do banco do cliente, pelo Escritor do @sgh/nucleo, uma transação por evento (só inclusão). As
// gravações de negócio não passam por aqui: o Executor grava a trilha delas na mesma transação da operação.
//
// - Estabelecimento e usuário entram pelo id do banco do cliente (lidos pelo código e pelo login). Login não
//   confirmado ou inexistente fica nulo: o texto digitado nunca vai à trilha.
// - A carga (dados_depois) leva só códigos, ids e o resultado: o evento do catálogo, o recurso, a estação e a chave
//   natural do alvo (sem dado pessoal por contrato do EventoParaTrilha).
// - Falha ao gravar propaga: quem chama decide se bloqueia a resposta ("sem trilha, sem dado").
import type { Ambiente, Escritor } from '@sgh/nucleo';
import { type AcaoTrilha, gravarTrilha } from '@sgh/nucleo';
import { marcaComoAtual } from './como.js';
import {
  type EventoParaTrilha,
  type RegistradorTrilha,
  type RegistroFeito,
  USUARIO_DESCONHECIDO,
} from './trilha.js';

/** O que o registrador usa do NucleoProprio (os testes trocam). */
export interface NucleoEscrita {
  escrever<T>(
    contexto: {
      readonly cliente: string;
      readonly estabelecimento: number | null;
      readonly usuario: number | null;
      readonly correlacao: string;
    },
    fn: (e: Escritor) => Promise<T>,
  ): Promise<T>;
}

/** Ação da trilha pelo código do evento do catálogo e pelo resultado. */
export function acaoDoEvento(evento: string, resultado: EventoParaTrilha['resultado']): AcaoTrilha {
  if (evento.startsWith('sessao.login')) return resultado === 'sucesso' ? 'login' : 'acesso_negado';
  if (evento === 'sessao.encerrada') return 'logout';
  if (resultado === 'falha') return 'acesso_negado';
  if (/\.(lido|lida|consultado|consultada|ler)$/.test(evento)) return 'consulta';
  if (/\.(impresso|impressa)$/.test(evento)) return 'impressao';
  if (/\.(exportado|exportada)$/.test(evento)) return 'exportacao';
  return 'operacao';
}

const FORMATO_TABELA = /^[a-z][a-z0-9_]{0,63}$/;
const FORMATO_ID = /^\d{1,19}$/;

export class RegistradorTrilhaPropria implements RegistradorTrilha {
  constructor(
    private readonly nucleo: NucleoEscrita,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  async registrar(e: EventoParaTrilha): Promise<RegistroFeito> {
    const correlacao = e.correlacao.slice(0, 64) || 'trilha';
    const id = await this.nucleo.escrever(
      { cliente: this.cliente, estabelecimento: null, usuario: null, correlacao },
      async (w) => {
        const est = e.hospital
          ? await w.uma<{ id: number }>(
              'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
              [e.hospital],
            )
          : null;
        const confirmado = !e.usuarioNaoConfirmado && e.usuario && e.usuario !== USUARIO_DESCONHECIDO;
        const usu = confirmado
          ? await w.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [
              e.usuario,
            ])
          : null;
        const como = marcaComoAtual();
        const tabela = e.tabelaAlvo && FORMATO_TABELA.test(e.tabelaAlvo) ? e.tabelaAlvo : 'sessao';
        const idAlvo = e.idAlvo && FORMATO_ID.test(e.idAlvo) ? Number(e.idAlvo) : null;
        return gravarTrilha(w, {
          estabelecimento: est ? Number(est.id) : null,
          usuario: usu ? Number(usu.id) : null,
          acao: acaoDoEvento(e.evento, e.resultado),
          entidade: tabela,
          entidadeId: Number.isSafeInteger(idAlvo) ? idAlvo : null,
          dadosDepois: {
            evento: e.evento,
            recurso: e.recurso,
            resultado: e.resultado,
            estacao: e.estacao,
            ...(e.atendimento !== undefined ? { atendimento: e.atendimento } : {}),
            ...(e.paciente !== undefined ? { paciente: e.paciente } : {}),
            ...(e.chaveNaturalAlvo ? { chaveNatural: e.chaveNaturalAlvo } : {}),
            ...(como ? { como } : {}),
          },
          correlacao,
          ocorridoEm: this.agora(),
        });
      },
    );
    return { sgh: String(id), legado: null };
  }
}

/** O cliente da trilha própria (CLIENTE_PADRAO); sem ele, null (a partida com a fonte própria já recusa). */
export function clienteDaTrilha(env: Ambiente): string | null {
  return env['CLIENTE_PADRAO']?.trim() || null;
}
