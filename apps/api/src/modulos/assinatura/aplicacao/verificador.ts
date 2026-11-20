// Verificador público de documentos (M49, etapa 3; ficha, seções 4, 5 e 7; regra 9; cap-07 §7.6; cap-12 §12.4). Sem
// login: o código opaco do QR do documento assinado leva ao tipo, às datas, ao profissional (como o selo mostra) e ao
// resultado da validação mais recente no servidor; NUNCA o conteúdo clínico nem o paciente. Lê só SGH_ (nunca a tabela
// do outro sistema) em cada estabelecimento da rede, e cada consulta é registrada (`documento.registrarConsultaPublica`,
// SGH_DOC_VERIFICACAO, com a SGH_TRILHA na mesma transação) com a origem só mascarada. Limite de taxa por origem e por
// minuto (parâmetro `documento.verificadorConsultasPorMinuto`), no armazém compartilhado (Valkey): a consulta acima do
// limite responde 429 e só a primeira barrada do minuto vira linha.
import {
  EVENTOS_AUDITAVEIS,
  type PainelVerificador,
  ROTULOS_TIPO_DOCUMENTO_POLITICA,
  type SituacaoVerificacao,
  type TipoDocumentoPolitica,
  type VerificacaoPublica,
} from '@sgh/contratos';
import {
  chaveTaxaVerificador,
  chaveTetoGlobalVerificador,
  dentroDoLimite,
  formatoCodigoVerificador,
  mascararOrigem,
  primeiraBarrada,
  resultadoParaGravar,
  situacaoDaVerificacao,
} from '@sgh/dominio-documento';
import type { DocumentoVerificadoLido, LinhaTrilha } from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import { parametroDoEstabelecimento } from '../../sadt/aplicacao/liberacao.js';
import type { PortaAssinaturaIcp } from '../porta.js';

/** O contador do limite de taxa (o armazém das sessões: Valkey fora dos testes). */
export interface ContadorTaxa {
  incrementar(chave: string, ttlSegundos: number): Promise<number>;
}

export interface ConfigVerificador {
  readonly rede: string;
  /** Os estabelecimentos da rede onde o código é procurado (ESTABELECIMENTOS; o primeiro recebe as consultas sem achado). */
  readonly estabelecimentos: readonly string[];
  /** A base pública do verificador (a mesma do QR). */
  readonly endereco: string;
  /** Teto de consultas por minuto de TODAS as origens juntas (padrão TETO_GLOBAL_VERIFICADOR_POR_MINUTO). */
  readonly tetoGlobalPorMinuto?: number;
  readonly agora?: () => Date;
}

/**
 * Teto global do verificador por minuto (todas as origens): defesa contra a varredura distribuída, que troca de
 * origem para fugir do limite por origem. Acima dele, a consulta responde 429 e NADA é gravado (só a primeira barrada
 * do minuto vira linha), para que quem não fez login não gere escrita sem limite no banco compartilhado.
 */
export const TETO_GLOBAL_VERIFICADOR_POR_MINUTO = 600;

/**
 * Os estabelecimentos onde o verificador procura (HS-1): com o núcleo real, só os liberados (o estabelecimento cuja
 * árvore gerou o catálogo, a mesma regra da sessão), porque os scripts SGH_ do verificador só estão aplicados nele;
 * sem núcleo real (dev/ci sintético), os configurados. Nenhum liberado configurado: lista vazia (o verificador
 * responde 503, falha fechada).
 */
export function estabelecimentosDoVerificador(
  configurados: readonly string[],
  liberados: ReadonlySet<string> | null,
): string[] {
  const base = configurados.length ? [...configurados] : ['pc'];
  return liberados ? base.filter((h) => liberados.has(h)) : base;
}

/** Login da trilha das consultas públicas (o verificador não tem pessoa). */
export const USUARIO_VERIFICADOR = 'SGH.VERIFICADOR';
const LIMITE_PADRAO = 20;
const DIAS_PAINEL = 30;

const naoEncontrado: VerificacaoPublica = {
  situacao: 'nao-encontrado',
  tipoDocumento: null,
  emitidoEm: null,
  assinadoEm: null,
  profissional: null,
  registro: null,
  politica: null,
  carimboEm: null,
  hashPdf: null,
  validadaEm: null,
};

const rotuloTipo = (t: string): string | null =>
  ROTULOS_TIPO_DOCUMENTO_POLITICA[t as TipoDocumentoPolitica] ?? null;

export class ServicoVerificador {
  private readonly agora: () => Date;

  constructor(
    private readonly porta: PortaAssinaturaIcp,
    private readonly contador: ContadorTaxa,
    private readonly configuracao: FonteConfiguracao | null,
    readonly cfg: ConfigVerificador,
  ) {
    this.agora = cfg.agora ?? (() => new Date());
  }

  private get principal(): string | null {
    return this.cfg.estabelecimentos[0] ?? null;
  }

  async limitePorMinuto(): Promise<number> {
    const h = this.principal;
    if (!h) return LIMITE_PADRAO;
    const v = await parametroDoEstabelecimento(
      this.configuracao,
      this.cfg.rede,
      h,
      'documento.verificadorConsultasPorMinuto',
    ).catch(() => null);
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 ? n : LIMITE_PADRAO;
  }

  private trilha(
    hospital: string,
    resultado: string,
    previa: number | null,
    origem: string,
    correlacao: string,
  ): LinhaTrilha {
    return {
      rede: this.cfg.rede,
      hospital,
      usuario: USUARIO_VERIFICADOR,
      evento: EVENTOS_AUDITAVEIS.verificacaoPublicaConsultada.codigo,
      recurso: 'documento.verificador',
      operacao: 'documento.registrarConsultaPublica',
      tabelaAlvo: 'SGH_DOC_VERIFICACAO',
      idAlvo: previa === null ? null : String(previa),
      chaveNaturalAlvo: `verificacao:${resultado}`,
      resultado: resultado === 'barrada' ? 'falha' : 'sucesso',
      estacao: `PUBLICO:${origem}`.slice(0, 80),
      correlacao: correlacao.slice(0, 64),
      origem: 'portal',
    };
  }

  private async registrar(
    hospital: string,
    d: DocumentoVerificadoLido | null,
    resultado: 'valida' | 'invalida' | 'indeterminada' | 'pendente' | 'nao-encontrado' | 'barrada',
    origem: string,
    correlacao: string,
  ): Promise<void> {
    const achado = resultado !== 'nao-encontrado' && resultado !== 'barrada' && d !== null;
    try {
      await this.porta.gravar(
        { rede: this.cfg.rede, hospital },
        (g) =>
          g.registrarConsultaPublica({
            hospital,
            documento: achado ? d.documento : null,
            previa: achado ? d.previa : null,
            resultado,
            origemMascarada: origem,
          }),
        this.trilha(hospital, resultado, achado ? d.previa : null, origem, correlacao),
      );
    } catch {
      // Sem o registro da consulta (e a trilha), nada é mostrado: falha fechada.
      throw new ErroProblema(
        'indisponivel',
        503,
        'Verificador indisponível',
        'Não foi possível conferir o documento agora. Tente de novo em instantes.',
      );
    }
  }

  /** A consulta pública pelo código do QR (sem login). */
  async verificar(
    codigo: string,
    ip: string | null,
    correlacao = 'verificador',
  ): Promise<VerificacaoPublica> {
    const hospitalRegistro = this.principal;
    if (!hospitalRegistro)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Verificador indisponível',
        'Nenhum estabelecimento configurado.',
      );
    const origem = mascararOrigem(ip);
    const limite = await this.limitePorMinuto();
    const teto = Math.max(
      limite,
      Math.floor(this.cfg.tetoGlobalPorMinuto ?? TETO_GLOBAL_VERIFICADOR_POR_MINUTO),
    );
    let n: number;
    let global: number;
    try {
      global = await this.contador.incrementar(
        `${this.cfg.rede}:verificador:${chaveTetoGlobalVerificador(this.agora())}`,
        70,
      );
      n = await this.contador.incrementar(
        `${this.cfg.rede}:verificador:${chaveTaxaVerificador(ip, this.agora())}`,
        70,
      );
    } catch {
      throw new ErroProblema('indisponivel', 503, 'Verificador indisponível', 'Tente de novo em instantes.');
    }
    const muitas = () =>
      new ErroProblema(
        'muitas-tentativas',
        429,
        'Muitas consultas',
        'Aguarde um minuto antes de consultar de novo.',
      );
    // Teto global: acima dele, nada é gravado (só a primeira barrada do minuto, de todas as origens).
    if (!dentroDoLimite(global, teto)) {
      if (primeiraBarrada(global, teto))
        await this.registrar(hospitalRegistro, null, 'barrada', origem, correlacao);
      throw muitas();
    }
    if (!dentroDoLimite(n, limite)) {
      if (primeiraBarrada(n, limite))
        await this.registrar(hospitalRegistro, null, 'barrada', origem, correlacao);
      throw muitas();
    }
    // Formato inválido: nada é procurado nem gravado (não é um código do sistema).
    if (!formatoCodigoVerificador(codigo)) return naoEncontrado;
    let achado: { hospital: string; d: DocumentoVerificadoLido } | null = null;
    for (const hospital of this.cfg.estabelecimentos) {
      const d = await this.porta.documentoDoCodigo({ rede: this.cfg.rede, hospital }, codigo).catch(() => {
        throw new ErroProblema(
          'indisponivel',
          503,
          'Verificador indisponível',
          'Tente de novo em instantes.',
        );
      });
      if (d) {
        achado = { hospital, d };
        break;
      }
    }
    const situacao = situacaoDaVerificacao(achado?.d ?? null);
    const d = situacao === 'nao-encontrado' ? null : (achado?.d ?? null);
    await this.registrar(
      achado && d ? achado.hospital : hospitalRegistro,
      d,
      resultadoParaGravar(situacao, d),
      origem,
      correlacao,
    );
    if (!d) return naoEncontrado;
    return {
      situacao,
      tipoDocumento: rotuloTipo(d.tipo),
      emitidoEm: d.emitidoEm,
      assinadoEm: d.assinatura?.estado === 'assinada' ? d.assinarEm || null : null,
      profissional: d.profissional,
      registro: d.registro,
      politica: d.politicaIcp,
      carimboEm: d.assinatura?.carimboEm ?? null,
      hashPdf: d.assinatura?.estado === 'assinada' ? (d.assinatura.hashPdf ?? null) : null,
      validadaEm: d.validacao?.em ?? null,
    };
  }

  /** O painel interno (permissão `documento.verificador.ler`): as consultas dos últimos 30 dias, agregadas. */
  async painel(s: SessaoCadastro): Promise<PainelVerificador> {
    const desde = new Date(this.agora().getTime() - DIAS_PAINEL * 86_400_000);
    const linhas = await this.porta.resumoVerificacoes(s.porta, desde).catch(() => {
      throw new ErroProblema('indisponivel', 503, 'Painel indisponível', 'Tente de novo em instantes.');
    });
    const dias = new Map<string, Partial<Record<SituacaoVerificacao | 'barrada', number>>>();
    for (const l of linhas) {
      const m = dias.get(l.dia) ?? {};
      m[l.resultado] = (m[l.resultado] ?? 0) + l.consultas;
      dias.set(l.dia, m);
    }
    return {
      desde: desde.toISOString(),
      limitePorMinuto: await this.limitePorMinuto(),
      endereco: `${this.cfg.endereco.replace(/\/+$/, '')}/verificar`,
      dias: [...dias.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([dia, porResultado]) => ({
          dia,
          porResultado,
          total: Object.values(porResultado).reduce((a, b) => a + (b ?? 0), 0),
        })),
    };
  }
}
