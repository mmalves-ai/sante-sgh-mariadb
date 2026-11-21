// M58-F4: as rotas de convênios servidas pela fachada, com a mesma resposta da API original (routes/convenios.js e
// services/convenios.js da versão 0.23.0): lista com ?ativo, ?busca, ?limite (1 a 500, padrão 100), busca por
// palavra sem acento nem caixa, `sugestoes` só quando a busca volta vazia; um convênio pelo código (SMALLINT).
import { CODIGOS_ERRO_FACHADA as E, LIMITES_FACHADA } from '@sgh/contratos';
import { filtrarPorRelevancia, sugerirAgendas } from './busca.js';
import { erroFachada, erroValidacao, smallint } from './erros.js';

/** A linha lida do cadastro do convênio (código, nome aparado, situação aparada e se permite atendimento). */
export interface LinhaConvenioFachada {
  readonly cod: number;
  readonly nome: string | null;
  readonly situacao: string | null;
  readonly permiteAtend: number | string | null;
}

export interface ConvenioFachada {
  readonly codigo: number;
  readonly nome: string | null;
  readonly ativo: boolean;
  readonly permiteAtendimento: number | string | null;
}

export const mapConvenio = (r: LinhaConvenioFachada): ConvenioFachada => ({
  codigo: r.cod,
  nome: r.nome,
  ativo: r.situacao === 'A',
  permiteAtendimento: r.permiteAtend,
});

export interface FiltroConveniosFachada {
  readonly ativo: boolean | undefined;
  readonly busca: string | undefined;
  readonly limite: number | undefined;
}

const um = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/** A querystring de GET /convenios, com a coerção e as mensagens da validação da API original (primeira falha). */
export function lerFiltroConvenios(q: Readonly<Record<string, unknown>>): FiltroConveniosFachada {
  const ativoBruto = um(q['ativo']);
  let ativo: boolean | undefined;
  if (ativoBruto !== undefined) {
    if (ativoBruto === true || ativoBruto === 'true') ativo = true;
    else if (ativoBruto === false || ativoBruto === 'false') ativo = false;
    else throw erroValidacao('querystring', [{ tipo: 'type', campo: 'ativo', esperado: 'boolean' }]);
  }
  const buscaBruta = um(q['busca']);
  const busca = buscaBruta === undefined ? undefined : String(buscaBruta);
  if (busca !== undefined && busca.length > LIMITES_FACHADA.buscaMaxima)
    throw erroValidacao('querystring', [
      { tipo: 'maxLength', campo: 'busca', limite: LIMITES_FACHADA.buscaMaxima },
    ]);
  const limiteBruto = um(q['limite']);
  let limite: number | undefined;
  if (limiteBruto !== undefined) {
    const n = Number(limiteBruto);
    if (String(limiteBruto).trim() === '' || !Number.isInteger(n))
      throw erroValidacao('querystring', [{ tipo: 'type', campo: 'limite', esperado: 'integer' }]);
    if (n < 1) throw erroValidacao('querystring', [{ tipo: 'minimum', campo: 'limite', limite: 1 }]);
    if (n > LIMITES_FACHADA.conveniosLimiteMaximo)
      throw erroValidacao('querystring', [
        { tipo: 'maximum', campo: 'limite', limite: LIMITES_FACHADA.conveniosLimiteMaximo },
      ]);
    limite = n;
  }
  return { ativo, busca, limite };
}

/** GET /convenios: as linhas já vêm ordenadas por NOME (o ORDER BY da consulta). */
export function responderConvenios(linhas: readonly LinhaConvenioFachada[], f: FiltroConveniosFachada) {
  const base = f.ativo ? linhas.filter((r) => r.situacao === 'A') : linhas;
  const itens = filtrarPorRelevancia(base.map(mapConvenio), f.busca, (c) => c.nome ?? '', {
    limite: f.limite ?? LIMITES_FACHADA.conveniosLimitePadrao,
  });
  // As sugestões olham o cadastro inteiro (ativos e inativos), como a API original.
  const sugestoes =
    itens.length || !f.busca
      ? []
      : sugerirAgendas(
          f.busca,
          linhas.map((r) => r.nome ?? ''),
        );
  return { total: itens.length, convenios: itens, ...(f.busca ? { sugestoes } : {}) };
}

/** O código do caminho de GET /convenios/{codigo}: inteiro (validação) e SMALLINT (faixa). */
export function lerCodigoConvenio(bruto: string | undefined): number {
  if (bruto === undefined || bruto.trim() === '' || !Number.isInteger(Number(bruto)))
    throw erroValidacao('params', [{ tipo: 'type', campo: 'codigo', esperado: 'integer' }]);
  return smallint(Number(bruto), 'codigo');
}

export function responderConvenio(linha: LinhaConvenioFachada | null): ConvenioFachada {
  if (!linha) throw erroFachada(404, 'Convênio não encontrado', E.convenioNaoEncontrado);
  return mapConvenio(linha);
}
