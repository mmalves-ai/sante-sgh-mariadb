// Apoios de gravação do M25 (uma chave de liberação por funcionalidade, POL-3): a checagem à beira do leito (com os
// conflitos, a infusão e os aparelhos), o aprazamento, os sinais vitais, a passagem de plantão e a leitura obrigatória
// da dose (DP-26, depende da etiqueta de dose do M29). Cada operação leva a permissão de agir (vale também no
// servidor). Os parâmetros do novo da unidade resolvidos para a sessão (tipados: inteiro, booleano e texto).
import { definicaoParametro, PARAMETRO_DUPLA_CHECAGEM } from '@sgh/contratos';
import { resolverParametro } from '@sgh/dominio-config';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import { ApoioGravacao } from '../exames/public-api.js';
import type { GravadorSghEnfermagem, PortaEnfermagem } from './porta.js';
import type { ParametrosEnfermagem } from './servico.js';

export const CHAVE_CHECAGEM = 'enfermagem.checagem';
export const CHAVE_APRAZAMENTO = 'enfermagem.aprazamento';
export const CHAVE_SINAIS = 'enfermagem.sinaisVitais';
export const CHAVE_PLANTAO = 'enfermagem.plantao';
export const CHAVE_LEITURA_DOSE = 'enfermagem.leituraDose';
export const CHAVE_APARELHO = 'enfermagem.aparelhoAutorizado';

export const OPERACOES_CHECAGEM: Readonly<Record<string, string>> = {
  'enfermagem.checarAdministracao': 'enfermagem.administracao.checar',
  'enfermagem.estornarChecagem': 'enfermagem.administracao.estornar',
};
export const OPERACOES_APRAZAMENTO: Readonly<Record<string, string>> = {
  'enfermagem.aprazarHorario': 'enfermagem.horario.aprazar',
};

const EXTRAS_CHECAGEM = {
  conferir: 'enfermagem.administracao.conferir',
  conflito: 'enfermagem.conflito.resolver',
  infusao: 'enfermagem.administracao.checar',
  dispositivo: 'enfermagem.dispositivo.editar',
};
const EXTRAS_APRAZAMENTO = { registrarAprazamento: 'enfermagem.horario.aprazar' };
const EXTRAS_SINAIS = {
  registrarSinal: 'enfermagem.sinalVital.criar',
  retificarSinal: 'enfermagem.sinalVital.retificar',
};
const EXTRAS_PLANTAO = { passar: 'enfermagem.plantao.passar', aceitar: 'enfermagem.plantao.aceitar' };

export class ApoiosEnfermagem {
  readonly checagem: ApoioGravacao<GravadorSghEnfermagem>;
  readonly aprazamento: ApoioGravacao<GravadorSghEnfermagem>;
  readonly sinais: ApoioGravacao<GravadorSghEnfermagem>;
  readonly plantao: ApoioGravacao<GravadorSghEnfermagem>;
  readonly leituraDose: ApoioGravacao<GravadorSghEnfermagem>;
  readonly aparelho: ApoioGravacao<GravadorSghEnfermagem>;

  constructor(
    readonly porta: PortaEnfermagem,
    trilha: RegistradorTrilha,
    private readonly configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    const novo = (chave: string, nome: string, operacoes: Readonly<Record<string, string>>) =>
      new ApoioGravacao<GravadorSghEnfermagem>(
        { chave, nome, operacoes },
        porta,
        trilha,
        configuracao,
        cache,
      );
    this.checagem = novo(CHAVE_CHECAGEM, 'a checagem à beira do leito', OPERACOES_CHECAGEM);
    this.aprazamento = novo(
      CHAVE_APRAZAMENTO,
      'o aprazamento da prescrição pela enfermagem',
      OPERACOES_APRAZAMENTO,
    );
    this.sinais = novo(CHAVE_SINAIS, 'o registro dos sinais vitais e controles', {});
    this.plantao = novo(CHAVE_PLANTAO, 'a passagem de plantão', {});
    this.leituraDose = novo(CHAVE_LEITURA_DOSE, 'a leitura obrigatória da dose', {});
    this.aparelho = novo(CHAVE_APARELHO, 'a exigência de aparelho autorizado no envio sem rede', {});
  }

  /** M40: o parâmetro do estabelecimento sem sessão (a geração de cada hora do relatório de contingência). */
  async parametroDoEstabelecimento(rede: string, hospital: string, chave: string): Promise<string | null> {
    const def = definicaoParametro(chave);
    if (!def) return null;
    const valores = this.configuracao ? await this.configuracao.valoresParametro(rede, hospital) : [];
    return (
      resolverParametro(
        def,
        valores,
        { rede, empresa: null, estabelecimento: hospital, unidade: null, perfis: [], usuario: 'sgh.api' },
        new Date(),
      ).valor ?? def.padrao
    );
  }

  /** O parâmetro do novo resolvido para a sessão (unidade, estabelecimento, rede), tipado. */
  async valor(s: SessaoCadastro, chave: string, unidade: string | null): Promise<string | null> {
    const def = definicaoParametro(chave);
    if (!def) return null;
    let valores: Awaited<ReturnType<FonteConfiguracao['valoresParametro']>>;
    try {
      valores = this.configuracao ? await this.configuracao.valoresParametro(s.rede, s.hospital) : [];
    } catch {
      valores = [];
    }
    return resolverParametro(
      def,
      valores,
      { rede: s.rede, empresa: null, estabelecimento: s.hospital, unidade, perfis: [], usuario: s.login },
      new Date(),
    ).valor;
  }

  /** Os parâmetros da beira do leito para a unidade (sem valor: o padrão do registro). */
  async parametros(s: SessaoCadastro, unidade: string | null): Promise<ParametrosEnfermagem> {
    const bruto = async (k: string) =>
      (await this.valor(s, k, unidade)) ?? definicaoParametro(k)?.padrao ?? '';
    const n = async (k: string) => {
      const v = Number.parseInt(await bruto(k), 10);
      return Number.isFinite(v) ? v : Number(definicaoParametro(k)?.padrao ?? 0);
    };
    // O booleano do registro é "sim"/"nao" (o resolvedor); "true"/"false" (definições antigas) também valem.
    const b = async (k: string) => ['sim', 'true', 't'].includes((await bruto(k)).trim().toLowerCase());
    const t = async (k: string) => (await bruto(k)).trim();
    return {
      toleranciaMinutos: await n('enfermagem.toleranciaMinutos'),
      toleranciaTempoCriticoMinutos: await n('enfermagem.toleranciaTempoCriticoMinutos'),
      pulseiraObrigatoria: await b('enfermagem.pulseiraObrigatoria'),
      doseObrigatoria: await b('enfermagem.doseObrigatoria'),
      loteValidade: (await t('enfermagem.loteValidadeObrigatorio'))
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      duplaChecagem: await b(PARAMETRO_DUPLA_CHECAGEM),
      cacheHoras: await n('enfermagem.cacheTabletHoras'),
      inicioTurnoDiurno: (await t('enfermagem.inicioTurnoDiurno')) || '0700',
      intervaloSinaisHoras: await n('enfermagem.intervaloSinaisHoras'),
      alterarVelocidade: await b('enfermagem.alterarVelocidadeInfusao'),
    };
  }

  /** O estado de todas as funcionalidades e ações para as telas. */
  async gravacao(s: SessaoCadastro) {
    const [c, a, si, p, d, ap] = await Promise.all([
      this.checagem.gravacao(s, EXTRAS_CHECAGEM),
      this.aprazamento.gravacao(s, EXTRAS_APRAZAMENTO),
      this.sinais.gravacao(s, EXTRAS_SINAIS),
      this.plantao.gravacao(s, EXTRAS_PLANTAO),
      this.leituraDose.liberacao(s),
      this.aparelho.liberacao(s),
    ]);
    return {
      ligada: c.ligada,
      motivo: c.motivo,
      operacoes: { ...c.operacoes, ...a.operacoes, ...si.operacoes, ...p.operacoes },
      funcionalidades: {
        [CHAVE_CHECAGEM]: { ligada: c.ligada, motivo: c.motivo },
        [CHAVE_APRAZAMENTO]: { ligada: a.ligada, motivo: a.motivo },
        [CHAVE_SINAIS]: { ligada: si.ligada, motivo: si.motivo },
        [CHAVE_PLANTAO]: { ligada: p.ligada, motivo: p.motivo },
        [CHAVE_LEITURA_DOSE]: { ligada: d.ligada, motivo: d.motivo },
        [CHAVE_APARELHO]: { ligada: ap.ligada, motivo: ap.motivo },
      },
    };
  }
}
