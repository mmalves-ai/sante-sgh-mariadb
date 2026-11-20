// Pendências de assinatura avisadas ao sair (ficha do M23, regra 9): antes de encerrar a sessão, a casca consulta a
// mesma lista da tela de pendências; havendo documento aguardando assinatura, pergunta se assina agora ou sai mesmo
// assim. Sem a permissão de ver as pendências, ou sem resposta do servidor, sai direto (o aviso não prende ninguém).
import { lerPendencias } from '../../modulos/pep/api-documentos.js';
import { pode } from './pode.js';

/** Quantos documentos aguardam a assinatura de quem está saindo (0 sem a permissão ou sem resposta). */
export async function pendenciasAoSair(
  ler: () => Promise<{ total: number }> = () => lerPendencias(),
  podeVer: (codigo: string) => boolean = pode,
): Promise<number> {
  if (!podeVer('documento.documento.ler')) return 0;
  try {
    const r = await ler();
    return Number.isInteger(r.total) && r.total > 0 ? r.total : 0;
  } catch {
    return 0;
  }
}
