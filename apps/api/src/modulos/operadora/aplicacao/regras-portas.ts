// Regras comuns às portas da operadora (memória e banco): o anexo da resposta do prestador ou do complemento da
// autorização (conferido pelo conteúdo, nunca pelo nome) e a recusa do encerramento do auditor com pedidos em análise.
// A mesma regra vale nas duas implementações da porta, para que a memória de dev/ci e o banco recusem igual.
import { createHash } from 'node:crypto';
import { recusa } from '@sgh/nucleo';

/** Os tipos aceitos do anexo (pelos primeiros bytes) e o teto (2 MB). */
export const TIPOS_ANEXO_RESPOSTA = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export type TipoAnexoResposta = (typeof TIPOS_ANEXO_RESPOSTA)[number];
export const ANEXO_RESPOSTA_MAX_BYTES = 2 * 1024 * 1024;

/** O tipo pelo conteúdo: %PDF-, a assinatura do PNG ou o início do JPEG; outro conteúdo, nulo. */
export function tipoDoAnexoResposta(b: Uint8Array): TipoAnexoResposta | null {
  const em = (sig: readonly number[]) => b.length >= sig.length && sig.every((x, i) => b[i] === x);
  if (em([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (em([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (em([0xff, 0xd8, 0xff])) return 'image/jpeg';
  return null;
}

/** O nome do arquivo sem caminho nem caractere de controle (até 120); vazio vira "anexo". */
export function nomeDoAnexoResposta(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const limpo = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  return limpo || 'anexo';
}

/** O anexo: não vazio, até 2 MB, PDF/PNG/JPEG pelo conteúdo; devolve o nome limpo, o tipo, o tamanho e o SHA-256. */
export function conferirAnexoResposta(a: { nome: string; bytes: Uint8Array }): {
  nome: string;
  tipo: TipoAnexoResposta;
  tamanho: number;
  sha256: string;
} {
  if (a.bytes.length === 0) throw recusa('anexo-vazio', 'O arquivo anexado está vazio.', { campos: ['anexo'] });
  if (a.bytes.length > ANEXO_RESPOSTA_MAX_BYTES)
    throw recusa('anexo-grande', 'O anexo passa de 2 MB. Reduza o arquivo e envie de novo.', { campos: ['anexo'] });
  const tipo = tipoDoAnexoResposta(a.bytes);
  if (!tipo) throw recusa('anexo-tipo', 'O anexo precisa ser PDF, PNG ou JPEG.', { campos: ['anexo'] });
  return {
    nome: nomeDoAnexoResposta(a.nome),
    tipo,
    tamanho: a.bytes.length,
    sha256: createHash('sha256').update(a.bytes).digest('hex'),
  };
}

/**
 * A recusa do encerramento (ou da troca) do auditor com pedidos em análise, sem a redistribuição. O protocolo nulo é o
 * de outro estabelecimento: entra na contagem, nunca na amostra.
 */
export function recusaAuditorComPedidos(pedidos: readonly { protocolo: string | null }[]) {
  return recusa(
    'auditor-com-autorizacoes',
    `Este auditor é o responsável por ${pedidos.length} pedido(s) de autorização em análise. ` +
      'Escolha o auditor que assume esses pedidos (redistribuição) antes de encerrar a designação.',
    {
      campos: ['redistribuirPara'],
      dependentes: [
        {
          rotulo: 'Pedidos de autorização em análise',
          quantidade: pedidos.length,
          amostra: pedidos
            .map((p) => p.protocolo)
            .filter((p): p is string => p !== null)
            .slice(0, 10),
          origem: 'logica',
        },
      ],
    },
  );
}
