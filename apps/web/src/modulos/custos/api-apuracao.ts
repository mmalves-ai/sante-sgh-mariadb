// Cliente das telas "Custo por procedimento e por paciente" (/custos/apuracao) e "Resultado por unidade e por convênio"
// (/custos/resultado) (M54, etapa 5): apoio, painel da competência, apurar, aprovar pela versão lida, exportar a
// aprovada (só gerada), o relatório de custos (PDF/A), o resultado agrupado e as contas paginadas. As gravações vão com o
// CSRF e a Idempotency-Key (uma por intenção); Problem Details viram ErroApi com o código da recusa.
import type {
  AgrupamentoResultado,
  ApoioApuracaoCustos,
  ApuracaoCustos,
  ApurarCustos,
  ArquivoExportacaoCustos,
  DestinoExportacaoCustos,
  PaginaContasCusto,
  PainelApuracao,
  ResultadoCustos,
} from '@sgh/contratos';
import { z } from 'zod';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const C = '/api/custos';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const lerApoioApuracao = () => ler(`${C}/apuracao/apoio`, confiar<ApoioApuracaoCustos>());
export const lerPainelApuracao = (competencia: string) =>
  ler(`${C}/apuracao${qs({ competencia })}`, confiar<PainelApuracao>());
export const apurarCustos = (e: { competencia: string } & Partial<Omit<ApurarCustos, 'competencia'>>) =>
  enviar(`${C}/apuracao`, e, confiar<ApuracaoCustos>(), novaChave('m54.apurar'));
export const aprovarApuracao = (id: number, versao: number) =>
  enviar(`${C}/apuracao/${id}/aprovacao`, { versao }, confiar<ApuracaoCustos>(), novaChave('m54.aprovar'));
export const exportarCustos = (competencia: string, destino: DestinoExportacaoCustos) =>
  enviar(
    `${C}/apuracao/exportacao`,
    { competencia, destino },
    confiar<ArquivoExportacaoCustos>(),
    novaChave('m54.exportar'),
  );
export const lerResultadoCustos = (competencia: string, agrupamento: AgrupamentoResultado) =>
  ler(`${C}/resultado${qs({ competencia, agrupamento })}`, confiar<ResultadoCustos>());
export const lerContasCusto = (f: {
  competencia: string;
  convenio?: number | null;
  procedimento?: string | null;
  numero?: number | null;
  prontuario?: number | null;
  negativas?: boolean;
  pagina?: number;
}) =>
  ler(
    `${C}/resultado/contas${qs({
      competencia: f.competencia,
      convenio: f.convenio ?? null,
      procedimento: f.procedimento?.trim() || null,
      numero: f.numero ?? null,
      prontuario: f.prontuario ?? null,
      negativas: f.negativas ? 'sim' : null,
      pagina: f.pagina && f.pagina > 1 ? f.pagina : null,
    })}`,
    confiar<PaginaContasCusto>(),
  );

/** O relatório de custos da apuração vigente (PDF/A; o HTML quando o ambiente não tem o conversor). */
export async function lerRelatorioCustos(competencia: string): Promise<Blob> {
  const r = await fetch(`${C}/apuracao/relatorio${qs({ competencia })}`, {
    headers: { accept: 'application/pdf, text/html' },
  });
  if (!r.ok) throw await erroDaResposta(r);
  return r.blob();
}

/** Entrega um arquivo ao navegador (baixar com o nome dado). */
export function baixarArquivo(b: Blob, nome: string): void {
  const url = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
