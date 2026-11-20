// M55 (etapa 3): o contrato sintético do fornecedor para os cenários `com-contrato` de suprimentos.criarPedido e de
// financeiro.criarTituloPagar (a prova de que a linha do pedido e a do título não mudam com o vínculo). Gravado só em
// SGH_SUP_CONTRATO, na transação da reprodução (desfeita no fim): vigente desde o ano passado até o próximo, valor alto,
// o gestor e o fiscal dois usuários existentes (só os logins; nada lido de pessoa).
import type { Escritor } from '@sgh/legado';

export async function contratoSintetico(
  e: Escritor,
  o: {
    hospital: string;
    fornecedor: number;
    usuario: string;
    vencido?: boolean;
    valor?: number;
    /** O fim em dias a partir de hoje (negativo: vencido); vence `vencido`. */
    dias?: number;
  },
): Promise<number> {
  const us = await e.consultar(
    'SELECT FIRST 2 NOME FROM TBUSERS WHERE NOME <> ? ORDER BY NOME',
    [o.usuario],
    { teto: 2 },
  );
  if (us.length < 2) throw new Error('Usuários insuficientes na cópia para o gestor e o fiscal do contrato.');
  const [s] = await e.consultar(
    'SELECT CAST(NEXT VALUE FOR SGH_GEN_SUP_CONTRATO AS VARCHAR(20)) ID FROM RDB$DATABASE',
    [],
    {
      teto: 1,
    },
  );
  const id = Number(s?.['ID'] ?? 0);
  await e.executar(
    `INSERT INTO SGH_SUP_CONTRATO (ID, HOSPITAL, NUMERO, FORNECEDOR, TIPO, OBJETO, CRITICO, INICIO, FIM, VALOR, GESTOR,
       FISCAL, IDEMPOTENCY_KEY, USUARIO)
     VALUES (CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, ?, ?, 'fornecimento', 'CONTRATO SINTETICO DE TESTE M55',
       'F', DATEADD(-1 YEAR TO CURRENT_DATE), DATEADD(? DAY TO CURRENT_DATE), ?, ?, ?, ?, ?)`,
    [
      String(id),
      o.hospital,
      `SINT-${id}`.slice(0, 30),
      o.fornecedor,
      o.dias ?? (o.vencido ? -10 : 365),
      o.valor ?? 9_999_999,
      String(us[0]!['NOME']).trim(),
      String(us[1]!['NOME']).trim(),
      `${o.hospital}:sintetico-m55-${id}`,
      o.usuario.slice(0, 31),
    ],
  );
  return id;
}

/** O aditivo de prazo sintético (o novo fim em dias a partir de hoje) no contrato sintético. */
export async function aditivoDePrazoSintetico(
  e: Escritor,
  o: { hospital: string; contrato: number; dias: number; usuario: string },
): Promise<number> {
  const [s] = await e.consultar(
    'SELECT CAST(NEXT VALUE FOR SGH_GEN_SUP_CONTRATO_EVENTO AS VARCHAR(20)) ID FROM RDB$DATABASE',
    [],
    { teto: 1 },
  );
  const id = Number(s?.['ID'] ?? 0);
  await e.executar(
    `INSERT INTO SGH_SUP_CONTRATO_EVENTO (ID, HOSPITAL, ID_CONTRATO, TIPO, NOVO_FIM, NUMERO_TERMO, DESCRICAO,
       IDEMPOTENCY_KEY, USUARIO)
     VALUES (CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, CAST(CAST(? AS VARCHAR(20)) AS BIGINT), 'aditivo',
       DATEADD(? DAY TO CURRENT_DATE), 'TA-SINT', 'ADITIVO DE PRAZO SINTETICO M55', ?, ?)`,
    [
      String(id),
      o.hospital,
      String(o.contrato),
      o.dias,
      `${o.hospital}:sintetico-m55-ev-${id}`,
      o.usuario.slice(0, 31),
    ],
  );
  return id;
}
