// W1-01 (parte 9b): a PORTA da rotina das contas dormentes sobre a fonte da gestão de acessos (gestao-fonte.ts):
// contas e exceções pela leitura (legado: READ ONLY na cópia/banco; memória: o estado sintético), gestores de acessos
// ativos, bloqueio pelo executor (fonte.executar, com o estado da receita do catálogo) e trilha pelo registrador da API
// (só o login, dias e limite na chave natural; nunca senha nem dado de pessoa). Os parâmetros
// acesso.contasDormentes.{ligada,diasPessoal,diasDispositivo} vêm da fonte de configuração com a resolução por nível;
// sem ela, ou com erro de leitura, os padrões das definições (D-W101-29). O responsável da rotina é o gestor de acessos
// ativo que entrou mais recentemente (nunca uma conta que a própria rodada bloquearia: a receita recusa bloquear a si).
import { definicaoParametro } from '@sgh/contratos';
import { PADRAO_DORMENCIA, type ParametrosDormencia } from '@sgh/dominio-acesso';
import { excecoesDormenciaVigentes } from '@sgh/legado';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { FonteConfiguracao } from '../config/configuracao-fonte.js';
import type { PortaDormencia } from './contas-dormentes.js';
import type { FonteGestao } from './gestao-fonte.js';

export const PARAMETROS_DORMENCIA = {
  ligada: 'acesso.contasDormentes.ligada',
  diasPessoal: 'acesso.contasDormentes.diasPessoal',
  diasDispositivo: 'acesso.contasDormentes.diasDispositivo',
} as const;

/** Os três parâmetros do estabelecimento, cada um caindo no padrão da definição quando não resolve. */
export function parametrosDormenciaPelaConfiguracao(
  fonte: () => Pick<FonteConfiguracao, 'valoresParametro'> | null,
  agora: () => number = () => Date.now(),
): (rede: string, hospital: string) => Promise<ParametrosDormencia> {
  return async (rede, hospital) => {
    const f = fonte();
    const valores = f ? await f.valoresParametro(rede, hospital).catch(() => null) : null;
    const ler = (chave: string, padrao: boolean | number): unknown => {
      const def = definicaoParametro(chave);
      if (!def) return padrao;
      if (!valores) return valorTipado(def, def.padrao);
      try {
        return valorTipado(
          def,
          resolverParametro(
            def,
            valores,
            { rede, empresa: null, estabelecimento: hospital, unidade: null, perfis: [], usuario: '' },
            new Date(agora()),
          ).valor,
        );
      } catch {
        return padrao;
      }
    };
    const dias = (v: unknown, padrao: number) =>
      typeof v === 'number' && Number.isInteger(v) && v >= 30 && v <= 730 ? v : padrao;
    const ligada = ler(PARAMETROS_DORMENCIA.ligada, PADRAO_DORMENCIA.ligada);
    return {
      ligada: typeof ligada === 'boolean' ? ligada : PADRAO_DORMENCIA.ligada,
      diasPessoal: dias(
        ler(PARAMETROS_DORMENCIA.diasPessoal, PADRAO_DORMENCIA.diasPessoal),
        PADRAO_DORMENCIA.diasPessoal,
      ),
      diasDispositivo: dias(
        ler(PARAMETROS_DORMENCIA.diasDispositivo, PADRAO_DORMENCIA.diasDispositivo),
        PADRAO_DORMENCIA.diasDispositivo,
      ),
    };
  };
}

export interface OpcoesPortaDormencia {
  readonly fonte: () => FonteGestao;
  readonly parametros: (rede: string, hospital: string) => Promise<ParametrosDormencia>;
  readonly trilha: RegistradorTrilha;
}

export function portaDormenciaDaFonte(o: OpcoesPortaDormencia): PortaDormencia {
  return {
    contas: (rede, h) => o.fonte().contasDormencia(rede, h),
    async excecoes(rede, h) {
      const vigentes = excecoesDormenciaVigentes(await o.fonte().historicoExcecoesDormencia(rede, h));
      return vigentes.map((x) => ({ login: x.login, ate: x.ate, motivo: x.motivo }));
    },
    gestoresAtivos: async (rede, h) => (await o.fonte().gestoresAcesso(rede, h)).map((g) => g.login),
    parametros: (rede, h) => o.parametros(rede, h),
    receita: (nome, h) => o.fonte().receita(nome, h),
    executar: (nome, h, entrada, ctx) => o.fonte().executar(nome, h, entrada, ctx),
    async trilha(rede, hospital, l, correlacao) {
      await o.trilha.registrar({
        evento: l.evento,
        rede,
        hospital,
        usuario: 'ROTINA',
        estacao: 'rotina-contas-dormentes',
        correlacao,
        recurso: 'acesso.usuario',
        resultado: l.resultado,
        tabelaAlvo: l.login ? 'TBUSERS' : 'SGH_ACESSO_DORMENCIA_EXCECAO',
        ...(l.login ? { idAlvo: l.login } : {}),
        chaveNaturalAlvo: l.diferenca,
      });
    },
  };
}

/** O gestor de acessos ativo com a conexão mais recente (empate: ordem do login); null sem nenhum. */
export function responsavelDaFonte(
  fonte: () => FonteGestao,
): (rede: string, hospital: string) => Promise<string | null> {
  return async (rede, hospital) => {
    const f = fonte();
    const [gestores, contas] = await Promise.all([
      f.gestoresAcesso(rede, hospital),
      f.contasDormencia(rede, hospital),
    ]);
    const ultimo = new Map(contas.map((c) => [c.login, c.ultimoAcesso ?? '']));
    const ordem = gestores
      .map((g) => g.login)
      .filter((l) => ultimo.has(l))
      .sort((a, b) => (ultimo.get(b) ?? '').localeCompare(ultimo.get(a) ?? '') || a.localeCompare(b));
    return ordem[0] ?? null;
  };
}
