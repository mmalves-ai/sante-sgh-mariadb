// Avisos da onda 0 sobre o erro de uma consulta: indisponibilidade do servidor (rede fora ou 502, 503, 504; a
// contingência da regra 7) e a consulta fora do escopo da onda (403 com o motivo próprio; regra 3).
import { MOTIVO_FORA_DO_ESCOPO_ONDA_0 } from '@sgh/contratos';
import { ErroApi } from '../../casca/erros/problem-details.js';

export function indisponivel(erro: unknown): boolean {
  if (erro instanceof ErroApi) return erro.status === 502 || erro.status === 503 || erro.status === 504;
  return erro instanceof TypeError;
}

export function foraDoEscopo(erro: unknown): boolean {
  return (
    erro instanceof ErroApi && erro.status === 403 && erro.problema?.detail === MOTIVO_FORA_DO_ESCOPO_ONDA_0
  );
}
