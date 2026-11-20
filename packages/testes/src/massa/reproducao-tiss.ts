// Reprodução dos cenários de assinatura do pós-fechamento (M31; ficha, seção 9) pelo EXECUTOR, na transação da captura
// (sempre desfeita). As contas, os lotes e os itens são os da cópia (só os IDs, em memória; nenhum valor de linha sai):
//   - gerarLote: contas emitidas e fechadas fora de lote do convênio com contador e cadastro TISS (o pré-voo do gatilho
//     da conta passa); o montador é o gerador 04.03.00 com a guarda em memória; as recusas: a conta não emitida (IND_EMI
//     'F' na transação desfeita) e o XML que não valida (a quantidade de um procedimento acima do formato da TISS);
//   - registrarProtocolo: lotes sem protocolo; o mesmo protocolo em dois lotes e a limpeza com o protocolo registrado
//     antes pelo executor; o lote protocolado que os gatilhos não deixam apagar;
//   - registrarGlosa, registrarRecurso e registrarRetornoRecurso: itens de contas apresentadas no estado de cada cenário;
//   - fecharCompetencia: uma competência ainda aberta e uma já fechada.
// A versão de cada linha vem da releitura na própria transação (como a tela leria).
import {
  type CenarioCaptura,
  definirMontadorLoteTiss,
  ErroOperacao,
  type Escritor,
  versaoDaLinhaFaturamento,
} from '@sgh/legado';
import { criarMontadorLote, guardaXmlMemoria } from '@sgh/dominio-faturamento';

type Executar = (e: Escritor, entrada: unknown) => Promise<unknown>;

export const OPERACOES_REPRODUCAO_TISS = new Set([
  'faturamento.gerarLote',
  'faturamento.registrarProtocolo',
  'faturamento.registrarGlosa',
  'faturamento.registrarRecurso',
  'faturamento.registrarRetornoRecurso',
  'faturamento.fecharCompetencia',
]);

/** O montador da reprodução: o gerador 04.03.00 e o XSD oficial, com a guarda em memória (nada vai ao S3). */
export function montadorDaReproducao(): void {
  definirMontadorLoteTiss(criarMontadorLote(guardaXmlMemoria()));
}

const num = (v: unknown) => Number(v ?? 0);

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

async function um(
  e: Escritor,
  sql: string,
  o: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>> {
  const [r] = await e.consultar(sql, params, { teto: 1, tempoMaximoMs: 120_000 });
  if (!r) throw new Error(`Cenário sem dado na cópia: ${o}.`);
  return r;
}

async function versao(e: Escritor, tabela: 'FCCTAEXT' | 'FCLANEXT', id: number): Promise<string> {
  const [r] = await e.consultar(`SELECT DATA_HORA_ULTIMA_ATUALIZACAO C FROM ${tabela} WHERE ID = ?`, [id], {
    teto: 1,
  });
  return versaoDaLinhaFaturamento(r?.['C'] ?? null);
}

/** Conta emitida, fechada e fora de lote, do convênio com contador e cadastro TISS; o pré-voo do gatilho passa. */
const SQL_CONTA_LOTE = (
  tipo: 'E' | 'I',
  n: number,
  convenio: number | null,
  itens = '(SELECT COUNT(*) FROM FCLANEXT l WHERE l.ID_FCCTAEXT = c.ID) <= 300',
) => `SELECT FIRST ${n} c.ID, c.CON
  FROM FCCTAEXT c JOIN TBSEGUIA s ON s.CONV = c.CON AND s.TIPO_GUIA = 0 AND CHAR_LENGTH(TRIM(s.NUM_LOTE)) = 12
    JOIN TBCONVEN v ON v.COD = c.CON LEFT JOIN FCCTAEXT_FCTISSLOTEPROT x ON x.ID_FCCTAEXT = c.ID
  WHERE c.FECHADA = 'S' AND c.IND_EMI = 'T' AND c.TIPO_CTA = '${tipo}' AND x.ID_FCCTAEXT IS NULL AND v.REG_ANS > 0
    ${convenio !== null ? `AND c.CON = ${Math.trunc(convenio)}` : ''}
    AND COALESCE(c.MED_SOL, -1) = COALESCE((SELECT b.COD FROM TBCBOPRO b WHERE b.ID = c.ID_TBCBOPRO_SOLICITANTE), -1)
    AND COALESCE(c.MED_CTA, -1) = COALESCE((SELECT b.COD FROM TBCBOPRO b WHERE b.ID = c.ID_TBCBOPRO_PRINCIPAL_CTA), -1)
    AND (COALESCE(c.ID_MFCTAREC, 0) = 0 OR EXISTS (SELECT 1 FROM MFCTAREC m WHERE m.ID_MFCTAREC = c.ID_MFCTAREC))
    AND (COALESCE(c.PROC_SOL, 0) = 0 OR (SELECT COUNT(*) FROM TBPROCTO p WHERE p.ID_TBCTRTHM = (CASE TRIM(c.TIPO_CTA)
       WHEN 'E' THEN (SELECT v2.THM_E FROM TBCONVEN v2 WHERE v2.COD = c.CON) WHEN 'I' THEN (SELECT v2.THM FROM TBCONVEN v2 WHERE v2.COD = c.CON) END)
       AND p.COD_PROCEDIMENTO = c.PROC_SOL) = 1)
    AND EXISTS (SELECT 1 FROM FCLANEXT l WHERE l.ID_FCCTAEXT = c.ID AND l.VALOR_C > 0 AND l.TIPO IN (2, 3))
    AND ${itens}
    AND NOT EXISTS (SELECT 1 FROM FCFECMES f WHERE f.CONVENIO = c.CON AND f.ANO = c.ANOPRO AND f.MES = c.MESPRO)
  ORDER BY c.ID DESC`;

/** Lote sem protocolo (os recentes). */
const SQL_LOTE_SEM_PROTOCOLO = (n: number) =>
  `SELECT FIRST ${n} l.ID FROM FCTISSLOTEPROT l WHERE COALESCE(TRIM(l.NUM_PROTOCOLO), '') = '' AND l.ID_TBTISSTPGUIA IN (1, 2, 3)
     AND EXISTS (SELECT 1 FROM FCCTAEXT_FCTISSLOTEPROT x WHERE x.ID_FCTISSLOTEPROT = l.ID) ORDER BY l.ID DESC`;

const SQL_ITEM_APRESENTADO = (
  onde: string,
) => `SELECT FIRST 1 i.ID, i.VALOR_C, i.QTDE, i.VLR_PG, i.VLR_RE, i.DT_RE
  FROM FCCTAEXT c JOIN FCLANEXT i ON i.ID_FCCTAEXT = c.ID
  WHERE c.FECHADA = 'A' AND c.ANOPRO >= 2026 AND i.VALOR_C > 1 AND ${onde} ORDER BY c.ID DESC, i.ID`;

/** Um motivo da tabela 38 que não é 0 nem 3095 (admite reapresentação). */
const SQL_MOTIVO =
  "SELECT FIRST 1 m.CODIGO FROM TBMOTGLO m WHERE m.CODIGO NOT IN (0, 3095) AND m.REAPRESENTA = 'T' ORDER BY m.CODIGO";

export function cenarioTiss(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: (e: Escritor, operacao: string, entrada: unknown) => Promise<unknown>,
  operadorSintetico: (e: Escritor) => Promise<string>,
): CenarioCaptura {
  const chave = `${nome}/${cenario}`;
  montadorDaReproducao();
  let contas: number[] = [];
  let convenio = 0;
  let lote = 0;
  let lote2 = 0;
  let item = 0;
  let motivo = 0;
  let protocolo = '';
  let comp = { convenio: 0, ano: 0, mes: 0 };
  let linha: Record<string, unknown> = {};
  let hoje = '';
  let tipoGuiaConta = 2;
  let proximoLote = '';
  return {
    ...base,
    alvosNasTabelasMedias: true,
    chavesAlvo: () => ({
      ...(contas.length ? { FCCTAEXT: contas.map((ID) => ({ ID })) } : {}),
      // O lote novo pela chave natural (convênio + o próximo número do contador, conhecido antes de gravar) e os vínculos
      // pela conta (chave parcial da PK composta).
      ...(proximoLote
        ? {
            FCTISSLOTEPROT: [{ ID_TBCONVEN: convenio, NUM_LOTE: proximoLote }],
            FCCTAEXT_FCTISSLOTEPROT: contas.map((c) => ({ ID_FCCTAEXT: c })),
          }
        : lote
          ? { FCTISSLOTEPROT: [{ ID: lote }, ...(lote2 ? [{ ID: lote2 }] : [])] }
          : {}),
      ...(item ? { FCLANEXT: [{ ID: item }] } : {}),
    }),
    async preparar(e) {
      await operadorSintetico(e);
      const contador = async () => {
        const [x] = await e.consultar(
          'SELECT NUM_LOTE FROM TBSEGUIA WHERE CONV = ? AND TIPO_GUIA = 0',
          [convenio],
          {
            teto: 1,
          },
        );
        proximoLote = String(BigInt(String(x?.['NUM_LOTE'] ?? '0').trim() || '0') + 1n).padStart(12, '0');
      };
      const [h] = await e.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], {
        teto: 1,
      });
      hoje = String(h?.['H'] ?? '');
      switch (chave) {
        case 'faturamento.gerarLote/sp-sadt':
        case 'faturamento.gerarLote/consulta':
        case 'faturamento.gerarLote/conta-nao-emitida':
        case 'faturamento.gerarLote/xsd-invalido': {
          const c = await um(e, SQL_CONTA_LOTE('E', 1, null), 'conta externa pronta para o lote');
          contas = [num(c['ID'])];
          convenio = num(c['CON']);
          await contador();
          if (cenario === 'conta-nao-emitida')
            await e.executar("UPDATE FCCTAEXT SET IND_EMI = 'F' WHERE ID = ?", [contas[0]]);
          if (cenario === 'xsd-invalido')
            // A quantidade de um procedimento acima do formato da TISS (st_numerico3): o XSD recusa.
            await e.executar(
              'UPDATE FCLANEXT SET QTDE = 5000 WHERE ID = (SELECT FIRST 1 l.ID FROM FCLANEXT l WHERE l.ID_FCCTAEXT = ? AND l.VALOR_C > 0 AND l.TIPO IN (2, 3) ORDER BY l.TIPO, l.DATA, l.ID)',
              [contas[0]],
            );
          return;
        }
        case 'faturamento.gerarLote/conta-com-mais-de-500-itens': {
          // A guia sem corte: uma conta pronta com mais de 500 itens cobrados (8 no pc).
          const c = await um(
            e,
            SQL_CONTA_LOTE(
              'E',
              1,
              null,
              '(SELECT COUNT(*) FROM FCLANEXT l WHERE l.ID_FCCTAEXT = c.ID AND l.VALOR_C > 0) > 500',
            ).replace("c.TIPO_CTA = 'E'", "c.TIPO_CTA IN ('E', 'I')"),
            'conta pronta para o lote com mais de 500 itens',
          );
          contas = [num(c['ID'])];
          convenio = num(c['CON']);
          const t = await um(e, 'SELECT TIPO_CTA FROM FCCTAEXT WHERE ID = ?', 'tipo da conta', [contas[0]]);
          tipoGuiaConta = String(t['TIPO_CTA'] ?? '').trim() === 'I' ? 3 : 2;
          await contador();
          return;
        }
        case 'faturamento.gerarLote/competencia-fechada': {
          const c = await um(e, SQL_CONTA_LOTE('E', 1, null), 'conta externa pronta para o lote');
          contas = [num(c['ID'])];
          convenio = num(c['CON']);
          await contador();
          // A competência da conta fechada para o convênio pelo próprio executor (na transação desfeita).
          const k = await um(e, 'SELECT ANOPRO, MESPRO FROM FCCTAEXT WHERE ID = ?', 'competência da conta', [
            contas[0],
          ]);
          await executarOutra(e, 'faturamento.fecharCompetencia', {
            convenio,
            ano: num(k['ANOPRO']),
            mes: num(k['MESPRO']),
          });
          return;
        }
        case 'faturamento.gerarLote/resumo-internacao': {
          const c = await um(e, SQL_CONTA_LOTE('I', 1, null), 'conta de internação pronta para o lote');
          contas = [num(c['ID'])];
          convenio = num(c['CON']);
          await contador();
          return;
        }
        case 'faturamento.gerarLote/varias-contas': {
          // O convênio com pelo menos 3 contas prontas.
          const [c1] = await e.consultar(
            `SELECT FIRST 1 x.CON FROM (${SQL_CONTA_LOTE('E', 400, null).replace('SELECT FIRST 400 c.ID, c.CON', 'SELECT FIRST 400 c.CON')}) x GROUP BY x.CON HAVING COUNT(*) >= 3`,
            [],
            { teto: 1, tempoMaximoMs: 120_000 },
          );
          if (!c1) throw new Error('Cenário sem convênio com 3 contas prontas para o lote.');
          convenio = num(c1['CON']);
          const r = await e.consultar(SQL_CONTA_LOTE('E', 3, convenio), [], {
            teto: 3,
            tempoMaximoMs: 120_000,
          });
          contas = r.map((x) => num(x['ID']));
          await contador();
          return;
        }
        case 'faturamento.registrarProtocolo/protocolo-novo':
        case 'faturamento.registrarProtocolo/protocolo-com-crlf':
          lote = num((await um(e, SQL_LOTE_SEM_PROTOCOLO(1), 'lote sem protocolo'))['ID']);
          return;
        case 'faturamento.registrarProtocolo/mesmo-protocolo-dois-lotes':
        case 'faturamento.registrarProtocolo/limpar':
        case 'faturamento.registrarProtocolo/apagar-lote-protocolado': {
          const r = await e.consultar(SQL_LOTE_SEM_PROTOCOLO(2), [], { teto: 2 });
          if (r.length < 2) throw new Error('Cenário sem dois lotes sem protocolo.');
          lote = num(r[0]?.['ID']);
          lote2 = num(r[1]?.['ID']);
          protocolo = `S${String(Date.now() % 100_000_000_000).padStart(11, '0')}`;
          // O protocolo registrado antes pelo próprio executor (no outro lote, ou no mesmo para limpar e apagar).
          await executarOutra(e, 'faturamento.registrarProtocolo', {
            lote: cenario === 'mesmo-protocolo-dois-lotes' ? lote2 : lote,
            acao: 'registrar',
            protocolo,
          });
          return;
        }
        case 'faturamento.registrarGlosa/pago-integral':
        case 'faturamento.registrarGlosa/pago-parcial-com-motivo':
        case 'faturamento.registrarGlosa/glosado-total':
        case 'faturamento.registrarGlosa/motivo-zero':
          linha = await um(
            e,
            SQL_ITEM_APRESENTADO("COALESCE(i.GLOSADO, 'F') <> 'T'"),
            'item apresentado não baixado',
          );
          item = num(linha['ID']);
          motivo = num((await um(e, SQL_MOTIVO, 'motivo de glosa'))['CODIGO']);
          return;
        case 'faturamento.registrarRecurso/recurso-padrao':
        case 'faturamento.registrarRecurso/quantidade-fracionaria':
          linha = await um(
            e,
            SQL_ITEM_APRESENTADO("i.GLOSADO = 'T' AND i.VALOR_C > i.VLR_PG AND i.VLR_RE = 0 AND i.QTDE >= 1"),
            'item baixado com glosa e sem recurso',
          );
          item = num(linha['ID']);
          return;
        case 'faturamento.registrarRecurso/nao-conciliado':
          item = num(
            (await um(e, SQL_ITEM_APRESENTADO("COALESCE(i.GLOSADO, 'F') <> 'T'"), 'item não baixado'))['ID'],
          );
          return;
        case 'faturamento.registrarRecurso/ja-recorrido':
          item = num(
            (await um(e, SQL_ITEM_APRESENTADO("i.GLOSADO = 'T' AND i.VLR_RE > 0"), 'item recorrido'))['ID'],
          );
          return;
        case 'faturamento.registrarRetornoRecurso/acatado':
        case 'faturamento.registrarRetornoRecurso/parcial':
        case 'faturamento.registrarRetornoRecurso/negado':
        case 'faturamento.registrarRetornoRecurso/data-anterior-ao-recurso':
          linha = await um(
            e,
            SQL_ITEM_APRESENTADO(
              "i.VLR_RE >= 0.02 AND i.VLR_RP = 0 AND i.DT_RP < '1900-01-01' AND i.DT_RE >= '1900-01-01' AND i.QTD_RE > 0",
            ).replace('c.ANOPRO >= 2026', 'c.ANOPRO >= 2025'),
            'item em recurso sem retorno',
          );
          item = num(linha['ID']);
          motivo = num((await um(e, SQL_MOTIVO, 'motivo de glosa'))['CODIGO']);
          return;
        case 'faturamento.fecharCompetencia/convenio-mes': {
          const [d] = await e.consultar(
            'SELECT EXTRACT(YEAR FROM DATEADD(-1 MONTH TO CURRENT_DATE)) A, EXTRACT(MONTH FROM DATEADD(-1 MONTH TO CURRENT_DATE)) M FROM RDB$DATABASE',
            [],
            { teto: 1 },
          );
          const ano = num(d?.['A']);
          const mes = num(d?.['M']);
          const c = await um(
            e,
            "SELECT FIRST 1 v.COD FROM TBCONVEN v WHERE v.SITUACAO = 'A' AND v.COD > 0 AND NOT EXISTS (SELECT 1 FROM FCFECMES f WHERE f.CONVENIO = v.COD AND f.ANO = ? AND f.MES = ?) ORDER BY v.COD",
            'convênio com a competência aberta',
            [ano, mes],
          );
          comp = { convenio: num(c['COD']), ano, mes };
          return;
        }
        case 'faturamento.fecharCompetencia/ja-fechada': {
          const f = await um(
            e,
            'SELECT FIRST 1 CONVENIO, ANO, MES FROM FCFECMES ORDER BY ANO DESC, MES DESC',
            'competência fechada',
          );
          comp = { convenio: num(f['CONVENIO']), ano: num(f['ANO']), mes: num(f['MES']) };
          return;
        }
        default:
          throw new Error(`Cenário ${chave} sem reprodução.`);
      }
    },
    async executar(e) {
      const itemV = async () => ({ item, versao: await versao(e, 'FCLANEXT', item) });
      switch (chave) {
        case 'faturamento.gerarLote/sp-sadt':
        case 'faturamento.gerarLote/varias-contas':
        case 'faturamento.gerarLote/consulta':
        case 'faturamento.gerarLote/resumo-internacao':
        case 'faturamento.gerarLote/conta-com-mais-de-500-itens':
        case 'faturamento.gerarLote/competencia-fechada':
        case 'faturamento.gerarLote/conta-nao-emitida':
        case 'faturamento.gerarLote/xsd-invalido': {
          const entrada = {
            convenio,
            tipoGuia:
              cenario === 'consulta'
                ? 1
                : cenario === 'resumo-internacao'
                  ? 3
                  : cenario === 'conta-com-mais-de-500-itens'
                    ? tipoGuiaConta
                    : 2,
            contas: await Promise.all(
              contas.map(async (id) => ({ id, versao: await versao(e, 'FCCTAEXT', id) })),
            ),
          };
          if (cenario === 'conta-nao-emitida') return exigirRecusa(executar(e, entrada), 'conta-nao-emitida');
          if (cenario === 'xsd-invalido') return exigirRecusa(executar(e, entrada), 'xsd-invalido');
          if (cenario === 'competencia-fechada')
            return exigirRecusa(executar(e, entrada), 'competencia-fechada');
          const r = (await executar(e, entrada)) as { resultado?: { lote?: number } } | undefined;
          lote = num(r?.resultado?.lote);
          return;
        }
        case 'faturamento.registrarProtocolo/protocolo-novo':
          await executar(e, {
            lote,
            acao: 'registrar',
            protocolo: `N${String(Date.now() % 1e10).padStart(10, '0')}`,
          });
          return;
        case 'faturamento.registrarProtocolo/protocolo-com-crlf':
          await executar(e, { lote, acao: 'registrar', protocolo: ` C${String(Date.now() % 1e9)}\r\n\t ` });
          return;
        case 'faturamento.registrarProtocolo/mesmo-protocolo-dois-lotes':
          await executar(e, { lote, acao: 'registrar', protocolo });
          return;
        case 'faturamento.registrarProtocolo/limpar':
          await executar(e, { lote, acao: 'limpar', protocolo });
          return;
        case 'faturamento.registrarProtocolo/apagar-lote-protocolado': {
          // O outro sistema tentando tirar a conta do lote protocolado (e apagar o lote): os gatilhos BD recusam.
          for (const sql of [
            'DELETE FROM FCCTAEXT_FCTISSLOTEPROT WHERE ID_FCTISSLOTEPROT = ?',
            'DELETE FROM FCTISSLOTEPROT WHERE ID = ?',
          ]) {
            let recusou = false;
            try {
              await e.executar(sql, [lote]);
            } catch (x) {
              recusou = /TISS_PROTOCOLO|exception/i.test(x instanceof Error ? x.message : String(x));
            }
            if (!recusou) throw new Error('Cenário de recusa: o lote protocolado foi apagado.');
          }
          return;
        }
        case 'faturamento.registrarGlosa/pago-integral':
          await executar(e, {
            itens: [
              {
                ...(await itemV()),
                valorPago: num(linha['VALOR_C']),
                quantidadePaga: num(linha['QTDE']),
                motivo: 0,
              },
            ],
            dataPagamento: hoje,
          });
          return;
        case 'faturamento.registrarGlosa/pago-parcial-com-motivo':
          await executar(e, {
            itens: [
              {
                ...(await itemV()),
                valorPago: Math.round(num(linha['VALOR_C']) * 50) / 100,
                quantidadePaga: num(linha['QTDE']),
                motivo,
              },
            ],
            dataPagamento: hoje,
          });
          return;
        case 'faturamento.registrarGlosa/glosado-total':
          await executar(e, {
            itens: [{ ...(await itemV()), valorPago: 0, quantidadePaga: 0, motivo }],
            dataPagamento: hoje,
          });
          return;
        case 'faturamento.registrarGlosa/motivo-zero':
          return exigirRecusa(
            executar(e, {
              itens: [
                {
                  ...(await itemV()),
                  valorPago: Math.round(num(linha['VALOR_C']) * 50) / 100,
                  quantidadePaga: num(linha['QTDE']),
                  motivo: 0,
                },
              ],
              dataPagamento: hoje,
            }),
            'motivo-zero',
          );
        case 'faturamento.registrarRecurso/recurso-padrao':
          await executar(e, { itens: [await itemV()], dataProtocolo: hoje });
          return;
        case 'faturamento.registrarRecurso/quantidade-fracionaria':
          await executar(e, { itens: [{ ...(await itemV()), quantidade: 0.375 }], dataProtocolo: hoje });
          return;
        case 'faturamento.registrarRecurso/nao-conciliado':
          return exigirRecusa(executar(e, { itens: [await itemV()], dataProtocolo: hoje }), 'nao-conciliado');
        case 'faturamento.registrarRecurso/ja-recorrido':
          return exigirRecusa(executar(e, { itens: [await itemV()], dataProtocolo: hoje }), 'ja-recorrido');
        case 'faturamento.registrarRetornoRecurso/acatado':
          await executar(e, {
            itens: [{ ...(await itemV()), desfecho: 'acatado' }],
            data: hoje,
            numeroDemonstrativo: 'SINT-DEM-1',
          });
          return;
        case 'faturamento.registrarRetornoRecurso/parcial':
          await executar(e, {
            itens: [
              { ...(await itemV()), desfecho: 'parcial', valor: Math.floor(num(linha['VLR_RE']) * 50) / 100 },
            ],
            data: hoje,
            numeroDemonstrativo: 'SINT-DEM-2',
          });
          return;
        case 'faturamento.registrarRetornoRecurso/negado':
          await executar(e, {
            itens: [{ ...(await itemV()), desfecho: 'negado', motivo }],
            data: hoje,
            numeroDemonstrativo: 'SINT-DEM-3',
          });
          return;
        case 'faturamento.registrarRetornoRecurso/data-anterior-ao-recurso': {
          const dtRe = linha['DT_RE'] instanceof Date ? linha['DT_RE'] : new Date(String(linha['DT_RE']));
          const antes = new Date(dtRe.getTime() - 86_400_000);
          const p2 = (n: number) => String(n).padStart(2, '0');
          return exigirRecusa(
            executar(e, {
              itens: [{ ...(await itemV()), desfecho: 'acatado' }],
              data: `${antes.getFullYear()}-${p2(antes.getMonth() + 1)}-${p2(antes.getDate())}`,
              numeroDemonstrativo: 'SINT-DEM-4',
            }),
            'data-anterior-ao-recurso',
          );
        }
        case 'faturamento.fecharCompetencia/convenio-mes':
          await executar(e, comp);
          return;
        case 'faturamento.fecharCompetencia/ja-fechada':
          return exigirRecusa(executar(e, comp), 'ja-fechada');
        default:
          throw new Error(`Cenário ${chave} sem reprodução.`);
      }
    },
  };
}
