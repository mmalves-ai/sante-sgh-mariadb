// Validação da assinatura no servidor (M49; regra 3; SBIS-32 a SBIS-34, SBIS-40, ICP-04; DOC-ICP-15): cadeia até uma
// raiz ICP-Brasil do repositório atualizado, vigência, revogação (LCR/OCSP), KeyUsage com assinatura digital e não
// repúdio, política mínima AD-RB e, quando há carimbo do tempo, tudo conferido NA HORA DO CARIMBO (é o que faz a
// AD-RT continuar válida depois que o certificado vence ou é revogado). O serviço isolado consulta a cadeia e a
// revogação; aqui só a decisão, pura. Resultado: válida, inválida ou indeterminada (fonte fora do ar: nunca "válida").
import type { FalhaTransitoriaAssinatura, PoliticaAssinaturaIcp, ResultadoValidacao } from '@sgh/contratos';
import { conferirCpf, type CertificadoLido } from './certificado.js';
import { tipoPelaPolitica } from './oids.js';

export type SituacaoCadeia = 'ok' | 'invalida' | 'indisponivel';
export type SituacaoRevogacao = 'boa' | 'revogado' | 'lcr-indisponivel' | 'ocsp-indisponivel';

export interface FatosValidacao {
  readonly agora: Date;
  readonly certificado: CertificadoLido;
  readonly cadeia: SituacaoCadeia;
  readonly revogacao: SituacaoRevogacao;
  /** Data da revogação, quando revogado (a LCR/OCSP diz). */
  readonly revogadoEm?: Date | null;
  /** Hora do carimbo do tempo (AD-RT); sem carimbo, a referência é agora. */
  readonly carimboEm?: Date | null;
  /** Política da assinatura conferida (null: sem política ICP-Brasil identificada). */
  readonly politicaAssinatura: PoliticaAssinaturaIcp | null;
  /** Ao assinar: CPF do usuário da sessão (regra 2). Em importar/exportar/imprimir: não se aplica (undefined). */
  readonly cpfDoUsuario?: string | number | bigint | null;
}

export type MotivoValidacao =
  | 'cadeia-invalida'
  | 'cadeia-indisponivel'
  | 'fora-da-vigencia'
  | 'revogado'
  | 'revogacao-indisponivel'
  | 'fora-da-icp'
  | 'uso-da-chave'
  | 'sem-politica'
  | 'cpf-divergente'
  | 'cpf-ausente';

export interface ValidacaoDecidida {
  readonly resultado: ResultadoValidacao;
  readonly motivos: readonly MotivoValidacao[];
  readonly referencia: Date;
  readonly cadeia: boolean | null;
  readonly vigencia: boolean;
  readonly revogacao: boolean | null;
  readonly cpf: boolean | null;
  /** Indeterminada por fonte fora do ar: a assinatura fica pendente e é reprocessada (regra 5). */
  readonly falhaTransitoria: FalhaTransitoriaAssinatura | null;
}

export function decidirValidacao(f: FatosValidacao): ValidacaoDecidida {
  const ref = f.carimboEm ?? f.agora;
  const invalidos: MotivoValidacao[] = [];
  const indeterminados: MotivoValidacao[] = [];
  let falha: FalhaTransitoriaAssinatura | null = null;

  const cadeia = f.cadeia === 'ok' ? true : f.cadeia === 'invalida' ? false : null;
  if (f.cadeia === 'invalida') invalidos.push('cadeia-invalida');
  if (f.cadeia === 'indisponivel') {
    indeterminados.push('cadeia-indisponivel');
    falha = 'lcr-indisponivel';
  }

  const c = f.certificado;
  const vigencia = c.validoDe.getTime() <= ref.getTime() && ref.getTime() <= c.validoAte.getTime();
  if (!vigencia) invalidos.push('fora-da-vigencia');

  let revogacao: boolean | null = true;
  if (f.revogacao === 'revogado') {
    // Revogado DEPOIS do carimbo não invalida (AD-RT); sem data, vale como revogado antes.
    const antes = !f.revogadoEm || f.revogadoEm.getTime() <= ref.getTime();
    revogacao = !antes;
    if (antes) invalidos.push('revogado');
  } else if (f.revogacao !== 'boa') {
    revogacao = null;
    indeterminados.push('revogacao-indisponivel');
    falha = falha ?? f.revogacao;
  }

  if (tipoPelaPolitica(c.politicas) === null) invalidos.push('fora-da-icp');
  if (!c.usoDaChave?.assinaturaDigital || !c.usoDaChave.naoRepudio) invalidos.push('uso-da-chave');
  if (f.politicaAssinatura === null) invalidos.push('sem-politica');

  let cpf: boolean | null = null;
  if (f.cpfDoUsuario !== undefined) {
    const r = conferirCpf(c, f.cpfDoUsuario);
    cpf = r.ok;
    if (!r.ok) invalidos.push(r.motivo === 'cpf-divergente' ? 'cpf-divergente' : 'cpf-ausente');
  }

  const resultado: ResultadoValidacao = invalidos.length
    ? 'invalida'
    : indeterminados.length
      ? 'indeterminada'
      : 'valida';
  return {
    resultado,
    motivos: [...invalidos, ...indeterminados],
    referencia: ref,
    cadeia,
    vigencia,
    revogacao,
    cpf,
    falhaTransitoria: resultado === 'indeterminada' ? falha : null,
  };
}
