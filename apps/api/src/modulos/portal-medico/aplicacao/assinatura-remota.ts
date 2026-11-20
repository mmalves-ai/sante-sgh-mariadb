// W0-10 (M6): a fila de assinatura remota do portal do médico externo. O portal não assina nada sozinho: reaproveita
// o serviço da assinatura ICP-Brasil dos documentos emitidos (M49, etapa 2: a prévia exata, o lote numa autorização só
// do provedor, a validação no servidor e o carimbo do tempo) numa sessão do servidor com o login do sistema do
// profissional ligado à conta (o autor dos documentos), nunca com um login que venha da tela. Só o certificado em NUVEM
// (PSC por OAuth 2.0 + PKCE): o agente local A1/A3 fica no hospital. O provedor devolve à tela do portal (o redirect_uri
// próprio do portal, cadastrado no PSC), e a tela manda o state e o código pela sessão do portal (cookie SameSite).
import {
  type LoteIcpPreparado,
  type PedidoAssinaturaIcpResposta,
  type PedirAssinaturaIcp,
  type PendenciasIcpResposta,
  PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA,
  type PrepararLoteIcp,
  type ResultadoFluxoAssinatura,
} from '@sgh/contratos';
import type { SessaoCadastro } from '../../cadastro/comum.js';

/** O serviço da assinatura dos documentos (M49) que o portal reaproveita (o app.module liga; os testes, um falso). */
export interface FonteAssinaturaPortalMedico {
  /** O redirect_uri do portal (o mesmo no pedido e na troca do código, como o OAuth exige). */
  readonly retorno: string;
  fila(s: SessaoCadastro): Promise<PendenciasIcpResposta>;
  prepararLote(s: SessaoCadastro, e: PrepararLoteIcp): Promise<LoteIcpPreparado>;
  pedir(s: SessaoCadastro, e: PedirAssinaturaIcp, retorno: string): Promise<PedidoAssinaturaIcpResposta>;
  concluir(
    s: SessaoCadastro,
    q: { state: string; code: string | null; erro: string | null },
    retorno: string,
  ): Promise<ResultadoFluxoAssinatura>;
}

/**
 * O redirect_uri do portal a partir do da assinatura interna: o caminho da tela do portal no mesmo endereço (em
 * produção, https://host/...; no simulador, o caminho relativo).
 */
export function retornoDoPortalMedico(retornoInterno: string): string {
  return /^https:\/\//.test(retornoInterno)
    ? new URL(PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA, retornoInterno).toString()
    : PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA;
}

/**
 * A sessão do servidor para o serviço do M49: o login do profissional ligado (dono dos documentos e do certificado),
 * sem nenhuma permissão interna (`pode` sempre falso: nada da direção técnica) e sem "entrar como". A correlação da
 * trilha diz que veio do portal e de qual conta.
 */
export function sessaoDaAssinaturaRemota(x: {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly acesso: number;
  /** O IP de quem está no portal (a estação da trilha). */
  readonly ip: string | null;
}): SessaoCadastro {
  return {
    req: {
      headers: { 'x-correlacao': `portal-medico-M${x.acesso}-assinatura` },
      ip: x.ip ?? '',
    } as never,
    hospital: x.hospital,
    rede: x.rede,
    login: x.login,
    porta: { rede: x.rede, hospital: x.hospital } as never,
    pode: () => false,
  };
}
