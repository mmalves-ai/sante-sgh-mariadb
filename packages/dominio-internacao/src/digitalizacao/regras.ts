// Regras puras da digitalização certificada (M50, etapa 6; ficha, regra 12; CFM 1.821/2007; Lei 13.787/2018;
// Decreto 10.278/2020): o arquivo é um PDF, a resolução mínima, as páginas declaradas contra as do arquivo, a data do
// papel, a máquina do documento (capturado → conferido ou recusado → assinado) com a segregação (quem confere não é quem
// capturou; quem assina é quem conferiu) e o prazo de guarda. Nenhuma regra elimina papel nem arquivo (padrão "não
// eliminar"; a destinação é da Fase 6).
import { ANOS_GUARDA_DIGITALIZACAO, RESOLUCAO_MINIMA_DPI, type SituacaoDigitalizacao } from '@sgh/contratos';

export class ErroDigitalizacao extends Error {
  readonly codigo: string;
  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
    this.name = 'ErroDigitalizacao';
  }
}

/** O arquivo começa por "%PDF-" (o escâner entrega PDF; imagem solta não tem índice nem páginas). */
export function ehPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/**
 * Páginas do PDF contadas pelos objetos `/Type /Page` legíveis; null quando o arquivo guarda os objetos comprimidos
 * (object streams) e a contagem não é possível sem abrir o PDF.
 */
export function paginasDoPdf(bytes: Uint8Array): number | null {
  let texto = '';
  for (let i = 0; i < bytes.length; i++) texto += String.fromCharCode(bytes[i]!);
  const n = texto.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  return n > 0 ? n : null;
}

export interface CapturaConferida {
  readonly paginasArquivo: number | null;
}

/** Confere a captura antes de guardar: PDF, resolução, páginas e a data do papel (nunca no futuro). */
export function conferirCaptura(c: {
  bytes: Uint8Array;
  resolucaoDpi: number;
  paginas: number;
  dataDocumento: string;
  hoje: string;
}): CapturaConferida {
  if (!ehPdf(c.bytes)) throw new ErroDigitalizacao('nao-e-pdf', 'O arquivo precisa ser o PDF do escâner.');
  if (c.resolucaoDpi < RESOLUCAO_MINIMA_DPI)
    throw new ErroDigitalizacao(
      'resolucao-baixa',
      `A resolução mínima é de ${RESOLUCAO_MINIMA_DPI} dpi (Decreto 10.278/2020): digitalize de novo.`,
    );
  if (c.dataDocumento > c.hoje)
    throw new ErroDigitalizacao('data-futura', 'A data do documento em papel não pode ser depois de hoje.');
  const paginasArquivo = paginasDoPdf(c.bytes);
  if (paginasArquivo !== null && paginasArquivo !== c.paginas)
    throw new ErroDigitalizacao(
      'paginas-divergentes',
      `O arquivo tem ${paginasArquivo} página(s) e foram informadas ${c.paginas}: confira se faltou alguma folha.`,
    );
  return { paginasArquivo };
}

export type AcaoDigitalizacao = 'conferir-fiel' | 'conferir-recusar' | 'assinar';

/**
 * A situação nova pela ação, com a segregação: a conferência é de outra pessoa (não de quem capturou) e a assinatura é
 * de quem conferiu (atesta o que viu); o recusado e o assinado não mudam mais (o recusado é capturado de novo).
 */
export function transicaoDigitalizacao(
  atual: SituacaoDigitalizacao,
  acao: AcaoDigitalizacao,
  d: { quem: string; capturadoPor: string; conferidoPor: string | null },
): SituacaoDigitalizacao {
  const quem = d.quem.trim().toUpperCase();
  if (acao === 'assinar') {
    if (atual !== 'conferido')
      throw new ErroDigitalizacao(
        atual === 'assinado' ? 'ja-assinado' : 'nao-conferido',
        atual === 'assinado'
          ? 'O documento já foi assinado.'
          : 'Só se assina o documento conferido como fiel ao papel.',
      );
    if ((d.conferidoPor ?? '').trim().toUpperCase() !== quem)
      throw new ErroDigitalizacao(
        'assinante-nao-conferiu',
        'Quem assina é quem conferiu a fidelidade com o papel.',
      );
    return 'assinado';
  }
  if (atual !== 'capturado') throw new ErroDigitalizacao('ja-conferido', 'O documento já foi conferido.');
  if (d.capturadoPor.trim().toUpperCase() === quem)
    throw new ErroDigitalizacao(
      'mesma-pessoa',
      'A conferência da fidelidade é de outra pessoa, não de quem capturou o documento.',
    );
  return acao === 'conferir-fiel' ? 'conferido' : 'recusado';
}

/** Guarda até (Lei 13.787/2018, art. 6: 20 anos): a data da captura somada ao prazo, no mesmo dia do ano. */
export function guardaAte(capturadoEm: string, anos: number = ANOS_GUARDA_DIGITALIZACAO): string {
  const [a, m, d] = capturadoEm.slice(0, 10).split('-').map(Number) as [number, number, number];
  const dia = m === 2 && d === 29 ? 28 : d;
  return `${a + anos}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
