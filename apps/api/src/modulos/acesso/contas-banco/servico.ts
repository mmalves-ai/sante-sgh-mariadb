// M59-F1 (ficha do M59, seção 4 "Inventário de contas e privilégios"; regras 1, 4 e 5): o serviço do painel "Contas
// do banco de dados e privilégios". Só consulta: junta o que a porta leu do catálogo de segurança, a situação do
// hospital (passo "desligamento" do M58 executado, no registro versionado dos passos; `legado.contingencia` do
// estabelecimento, padrão ligado) e o plano versionado por módulo, e devolve o que o domínio decide. Nada aqui revoga:
// a revogação é script da TI com autorização do dono por passo (ficha, seção 12).
import {
  definicaoParametro,
  EXCECOES_DELETE_CLINICO,
  esquemaDesviosPrivilegiosResposta,
  esquemaImutabilidadeResposta,
  esquemaInventarioContasBancoResposta,
  PREFIXOS_SGH_CLINICOS,
  TABELAS_CLINICAS_LEGADO,
  sufixoModuloBanco,
  type DesviosPrivilegiosResposta,
  type ImutabilidadeResposta,
  type InventarioContasBancoResposta,
} from '@sgh/contratos';
import {
  itensPlanoComDeleteClinico,
  montarDesvios,
  montarInventarioContas,
  nomesLegiveis,
  planejarPrivilegios,
  resumirDeleteClinico,
} from '@sgh/dominio-acesso';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import { alcanceVersionado, operacoesComDeleteClinicoDoCatalogo } from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import { lerRegistroDesligamento } from '../../coexistencia/public-api.js';
import type { ContextoContasBanco, PortaContasBanco } from './porta.js';

export const PARAMETRO_CONTINGENCIA = 'legado.contingencia';
/** Janela mínima de medição do uso antes de revogar por desuso (D-JANELA-59). */
export const JANELA_MINIMA_DIAS = 90;

export interface DependenciasContasBanco {
  readonly porta: PortaContasBanco;
  /** docs/coexistencia/desligamento (o registro versionado dos passos do M58). */
  readonly raizDesligamento: string;
  readonly configuracao?: FonteConfiguracao | null;
  readonly agora?: () => number;
}

export interface SituacaoHospital {
  readonly desligado: boolean;
  readonly contingenciaAtiva: boolean;
  readonly avisos: readonly string[];
}

export class ServicoContasBanco {
  constructor(private readonly d: DependenciasContasBanco) {}

  private agora(): number {
    return this.d.agora ? this.d.agora() : Date.now();
  }

  /** Regra 1: desligado pelo M58 e a contingência (padrão ligada; sem a fonte ou com erro, ligada: falha fechada). */
  async situacao(c: ContextoContasBanco): Promise<SituacaoHospital> {
    const avisos: string[] = [];
    const { registro, invalido } = lerRegistroDesligamento(this.d.raizDesligamento, c.hospital);
    if (invalido) avisos.push(`registro dos passos do desligamento: ${invalido}`);
    const desligado = registro.passos.desligamento.execucao !== null;
    let contingenciaAtiva = true;
    const def = definicaoParametro(PARAMETRO_CONTINGENCIA);
    if (def && this.d.configuracao) {
      try {
        const valores = await this.d.configuracao.valoresParametro(c.rede, c.hospital);
        const v = valorTipado(
          def,
          resolverParametro(
            def,
            valores,
            {
              rede: c.rede,
              empresa: null,
              estabelecimento: c.hospital,
              unidade: null,
              perfis: [],
              usuario: '',
            },
            new Date(this.agora()),
          ).valor,
        );
        contingenciaAtiva = v !== false;
      } catch {
        avisos.push('parâmetro da contingência ilegível: considerada aberta');
      }
    } else avisos.push('parâmetros indisponíveis: contingência considerada aberta');
    return { desligado, contingenciaAtiva, avisos };
  }

  async inventario(c: ContextoContasBanco): Promise<InventarioContasBancoResposta> {
    const sgh = this.d.porta.contasSgh(c.hospital);
    const [lido, situacao] = await Promise.all([
      this.d.porta.lerInventario(c, nomesLegiveis(sgh)),
      this.situacao(c),
    ]);
    const avisos = [
      ...situacao.avisos,
      'uso das contas ainda não medido: a medição é feita no servidor do hospital, pela TI',
    ];
    return esquemaInventarioContasBancoResposta.parse(
      montarInventarioContas({
        hospital: c.hospital,
        em: new Date(this.agora()).toISOString(),
        contas: lido.contas,
        loginsNaoLegiveis: lido.loginsNaoLegiveis,
        usos: [],
        sgh,
        contexto: {
          desligado: situacao.desligado,
          contingenciaAtiva: situacao.contingenciaAtiva,
          decisoes: new Set(),
          janelaMinimaDias: JANELA_MINIMA_DIAS,
        },
        avisos,
      }),
    );
  }

  async desvios(c: ContextoContasBanco): Promise<DesviosPrivilegiosResposta> {
    const alcance = alcanceVersionado(c.hospital);
    if (!alcance) {
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Plano de privilégios ausente',
        'O plano de privilégios por módulo deste estabelecimento ainda não foi gerado.',
      );
    }
    const reais = await this.d.porta.lerPrivilegiosSgh(c);
    const comConta = new Set(this.d.porta.modulosComConta(c.hospital));
    return esquemaDesviosPrivilegiosResposta.parse(
      montarDesvios({
        hospital: c.hospital,
        em: new Date(this.agora()).toISOString(),
        alcances: alcance.alcances,
        reais,
        contasConfiguradas: new Set(
          alcance.alcances.map((a) => a.modulo).filter((m) => comConta.has(sufixoModuloBanco(m))),
        ),
      }),
    );
  }

  /**
   * M59-F3 (regra 6; SBIS-26): a imutabilidade clínica por privilégio. Operações do catálogo e plano por módulo sem
   * DELETE clínico (fora das exceções), e quem ainda apaga registro clínico no banco (a conta ampla da aplicação,
   * enquanto existir, é a concessão vigente; o script 0002 a revoga).
   */
  async imutabilidade(c: ContextoContasBanco): Promise<ImutabilidadeResposta> {
    const sgh = this.d.porta.contasSgh(c.hospital);
    const alcance = alcanceVersionado(c.hospital);
    const plano = alcance ? planejarPrivilegios(alcance.alcances) : [];
    const linhas = await this.d.porta.lerDeleteClinico(c, nomesLegiveis(sgh));
    const doSante = new Set([...sgh.aplicacao, ...(sgh.scripts ? [sgh.scripts] : [])]);
    const r = resumirDeleteClinico(linhas, (t) => doSante.has(t) || t.startsWith('SGH_'));
    return esquemaImutabilidadeResposta.parse({
      hospital: c.hospital,
      em: new Date(this.agora()).toISOString(),
      tabelasClinicas: {
        legado: TABELAS_CLINICAS_LEGADO.length,
        // As SGH_ clínicas que algum módulo usa (alcance versionado).
        sgh: new Set(
          (alcance?.alcances ?? []).flatMap((a) =>
            Object.keys(a.objetos).filter((t) => PREFIXOS_SGH_CLINICOS.some((p) => t.startsWith(p))),
          ),
        ).size,
      },
      operacoesComDelete: operacoesComDeleteClinicoDoCatalogo(),
      planoComDelete: itensPlanoComDeleteClinico(plano).length,
      excecoes: EXCECOES_DELETE_CLINICO.map((e) => ({ tabela: e.tabela, motivo: e.motivo })),
      titulares: r.titulares,
      concessaoVigente: r.concessaoVigente,
    });
  }
}
