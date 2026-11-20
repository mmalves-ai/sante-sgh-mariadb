// Reprodução dos cenários de assinatura da conta do paciente (M30; ficha, seção 9) pelo EXECUTOR, na transação da
// captura (sempre desfeita). As contas e os itens são os da cópia (só os IDs, em memória; nenhum valor de linha sai):
//   - fechar: a conta externa e a de internação emitidas e consistentes (os vetos e o pré-voo passam), a conta por
//     pacote (C) emitida; as recusas montadas na transação desfeita, como o outro sistema deixaria a conta: IND_EMI 'F'
//     (não emitida), o total da conta acima da soma dos itens, a tabela de honorários do convênio sem o procedimento
//     solicitado (o pré-voo do gatilho; D-PREVOO-30), a pendência bloqueante registrada pelo novo;
//   - reabrir: a conta fechada fora de lote; as recusas na conta apresentada e na fechada em lote TISS;
//   - conferir: um e três itens não conferidos de uma conta aberta; a recusa na conta fechada.
// A trava e o carimbo da versão vêm da releitura na própria transação (como a tela leria).
import {
  type CenarioCaptura,
  ErroOperacao,
  type Escritor,
  registrarPendenciaSgh,
  versaoDaLinhaFaturamento,
} from '@sgh/legado';

type Executar = (e: Escritor, entrada: unknown) => Promise<unknown>;

export const OPERACOES_REPRODUCAO_FATURAMENTO = new Set([
  'faturamento.fecharConta',
  'faturamento.reabrirConta',
  'faturamento.conferirItem',
]);

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

/** Conta aberta, emitida e consistente: todos os vetos e o pré-voo do gatilho passam. */
const SQL_EMITIDA = (tipo: 'E' | 'I', pacote: 'N' | 'C') => `SELECT FIRST 1 c.ID FROM FCCTAEXT c
  WHERE c.FECHADA = 'N' AND c.IND_EMI = 'T' AND c.REMESSA <> 0 AND c.DATA_EMI > CAST('1900-01-01' AS DATE)
    AND c.TIPO_CTA = '${tipo}' AND COALESCE(c.PACOTE, '') ${pacote === 'C' ? "= 'C'" : "IN ('N', '')"}
    AND COALESCE(c.MED_SOL, -1) = COALESCE((SELECT b.COD FROM TBCBOPRO b WHERE b.ID = c.ID_TBCBOPRO_SOLICITANTE), -1)
    AND COALESCE(c.MED_CTA, -1) = COALESCE((SELECT b.COD FROM TBCBOPRO b WHERE b.ID = c.ID_TBCBOPRO_PRINCIPAL_CTA), -1)
    AND (COALESCE(c.ID_MFCTAREC, 0) = 0 OR EXISTS (SELECT 1 FROM MFCTAREC m WHERE m.ID_MFCTAREC = c.ID_MFCTAREC))
    AND (COALESCE(c.PROC_SOL, 0) = 0 OR (SELECT COUNT(*) FROM TBPROCTO p WHERE p.ID_TBCTRTHM = (CASE TRIM(c.TIPO_CTA)
       WHEN 'E' THEN (SELECT v.THM_E FROM TBCONVEN v WHERE v.COD = c.CON) WHEN 'I' THEN (SELECT v.THM FROM TBCONVEN v WHERE v.COD = c.CON) END)
       AND p.COD_PROCEDIMENTO = c.PROC_SOL) = 1)
    AND EXISTS (SELECT 1 FROM FCLANEXT l WHERE l.ID_FCCTAEXT = c.ID)
    ${pacote === 'C' ? '' : 'AND ABS(COALESCE(c.TOTAL_CONTA, 0) - (SELECT COALESCE(SUM(l.VALOR_C), 0) FROM FCLANEXT l WHERE l.ID_FCCTAEXT = c.ID)) <= 0.005'}
    AND NOT EXISTS (SELECT 1 FROM SGH_FAT_PENDENCIA p WHERE p.ID_FCCTAEXT = c.ID AND p.ABERTA = 'S' AND p.BLOQUEANTE = 'S')
    AND NOT EXISTS (SELECT 1 FROM FCFECMES f WHERE f.CONVENIO = c.CON AND f.ANO = c.ANOPRO AND f.MES = c.MESPRO)
  ORDER BY c.ID DESC`;

async function umaConta(e: Escritor, sql: string, o: string): Promise<number> {
  const [r] = await e.consultar(sql, [], { teto: 1, tempoMaximoMs: 120_000 });
  if (!r) throw new Error(`Cenário sem conta na cópia: ${o}.`);
  return num(r['ID']);
}

async function versaoConta(e: Escritor, id: number): Promise<string> {
  const [r] = await e.consultar('SELECT DATA_HORA_ULTIMA_ATUALIZACAO C FROM FCCTAEXT WHERE ID = ?', [id], {
    teto: 1,
  });
  return versaoDaLinhaFaturamento(r?.['C'] ?? null);
}

export function cenarioFaturamento(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  hospital: string,
  executar: Executar,
  operadorSintetico: (e: Escritor) => Promise<string>,
): CenarioCaptura {
  const chave = `${nome}/${cenario}`;
  let conta = 0;
  let itens: { id: number; versao: string }[] = [];
  return {
    ...base,
    alvosNasTabelasMedias: true,
    chavesAlvo: () => ({
      FCCTAEXT: conta ? [{ ID: conta }] : [],
      ...(itens.length ? { FCLANEXT: itens.map((i) => ({ ID: i.id })) } : {}),
    }),
    async preparar(e) {
      const operador = await operadorSintetico(e);
      switch (chave) {
        case 'faturamento.fecharConta/externa-emitida':
          conta = await umaConta(e, SQL_EMITIDA('E', 'N'), 'externa emitida');
          return;
        case 'faturamento.fecharConta/internacao-emitida':
          conta = await umaConta(e, SQL_EMITIDA('I', 'N'), 'internação emitida');
          return;
        case 'faturamento.fecharConta/conta-pacote-c':
          conta = await umaConta(e, SQL_EMITIDA('I', 'C'), 'conta por pacote emitida');
          return;
        case 'faturamento.fecharConta/nao-emitida':
          conta = await umaConta(e, SQL_EMITIDA('E', 'N'), 'externa emitida');
          await e.executar("UPDATE FCCTAEXT SET IND_EMI = 'F' WHERE ID = ?", [conta]);
          return;
        case 'faturamento.fecharConta/total-diverge':
          conta = await umaConta(e, SQL_EMITIDA('E', 'N'), 'externa emitida');
          await e.executar('UPDATE FCCTAEXT SET TOTAL_CONTA = COALESCE(TOTAL_CONTA, 0) + 10 WHERE ID = ?', [
            conta,
          ]);
          return;
        case 'faturamento.fecharConta/procedimento-fora-da-tabela': {
          // D-PREVOO-30: o solicitante inválido não existe na cópia e o gatilho da conta e o do cadastro de profissionais
          // não deixam criá-lo; o pré-voo é provado pela outra exceção do gatilho: a tabela de honorários externa do
          // convênio passa a ser uma que não tem o procedimento solicitado (como o outro sistema permite trocar).
          conta = await umaConta(
            e,
            SQL_EMITIDA('E', 'N').replace('ORDER BY', 'AND COALESCE(c.PROC_SOL, 0) > 0 ORDER BY'),
            'externa emitida com procedimento',
          );
          await e.executar(
            `UPDATE TBCONVEN v SET v.THM_E = (SELECT FIRST 1 t.COD FROM TBCTRTHM t WHERE NOT EXISTS (SELECT 1 FROM TBPROCTO p
               WHERE p.ID_TBCTRTHM = t.COD AND p.COD_PROCEDIMENTO = (SELECT c.PROC_SOL FROM FCCTAEXT c WHERE c.ID = ?)) ORDER BY t.COD)
             WHERE v.COD = (SELECT c.CON FROM FCCTAEXT c WHERE c.ID = ?)`,
            [conta, conta],
          );
          return;
        }
        case 'faturamento.fecharConta/com-pendencia-bloqueante':
          conta = await umaConta(e, SQL_EMITIDA('E', 'N'), 'externa emitida');
          await registrarPendenciaSgh(e, {
            hospital,
            usuario: operador,
            conta,
            tipo: 0,
            descricao: 'sghrepro: pendência sintética da reprodução',
            bloqueante: true,
          });
          return;
        case 'faturamento.reabrirConta/fechada-s':
          conta = await umaConta(
            e,
            "SELECT FIRST 1 c.ID FROM FCCTAEXT c WHERE c.FECHADA = 'S' AND NOT EXISTS (SELECT 1 FROM FCCTAEXT_FCTISSLOTEPROT x WHERE x.ID_FCCTAEXT = c.ID) AND COALESCE(c.MED_SOL, -1) = COALESCE((SELECT b.COD FROM TBCBOPRO b WHERE b.ID = c.ID_TBCBOPRO_SOLICITANTE), -1) ORDER BY c.ID DESC",
            'fechada fora de lote',
          );
          return;
        case 'faturamento.reabrirConta/apresentada-a':
          conta = await umaConta(
            e,
            "SELECT FIRST 1 c.ID FROM FCCTAEXT c WHERE c.FECHADA = 'A' ORDER BY c.ID DESC",
            'apresentada',
          );
          return;
        case 'faturamento.reabrirConta/em-lote':
          conta = await umaConta(
            e,
            "SELECT FIRST 1 c.ID FROM FCCTAEXT c JOIN FCCTAEXT_FCTISSLOTEPROT x ON x.ID_FCCTAEXT = c.ID WHERE c.FECHADA = 'S' ORDER BY c.ID DESC",
            'fechada em lote',
          );
          return;
        case 'faturamento.conferirItem/um-item':
        case 'faturamento.conferirItem/bloco': {
          const n = chave.endsWith('bloco') ? 3 : 1;
          const [c] = await e.consultar(
            `SELECT FIRST 1 c.ID FROM FCCTAEXT c WHERE c.FECHADA = 'N' AND c.ANOPRO >= 2026
               AND (SELECT COUNT(*) FROM FCLANEXT l WHERE l.ID_FCCTAEXT = c.ID AND COALESCE(l.USUARIO_CONFERENCIA, '') = '') >= ${n}
               ORDER BY c.ID DESC`,
            [],
            { teto: 1, tempoMaximoMs: 120_000 },
          );
          if (!c) throw new Error('Cenário sem conta aberta com itens não conferidos.');
          conta = num(c['ID']);
          const ls = await e.consultar(
            `SELECT FIRST ${n} ID, DATA_HORA_ULTIMA_ATUALIZACAO C FROM FCLANEXT WHERE ID_FCCTAEXT = ? AND COALESCE(USUARIO_CONFERENCIA, '') = '' ORDER BY ID`,
            [conta],
            { teto: n },
          );
          itens = ls.map((l) => ({ id: num(l['ID']), versao: versaoDaLinhaFaturamento(l['C'] ?? null) }));
          return;
        }
        case 'faturamento.conferirItem/conta-fechada': {
          conta = await umaConta(
            e,
            "SELECT FIRST 1 c.ID FROM FCCTAEXT c WHERE c.FECHADA = 'S' ORDER BY c.ID DESC",
            'fechada',
          );
          const ls = await e.consultar(
            'SELECT FIRST 1 ID, DATA_HORA_ULTIMA_ATUALIZACAO C FROM FCLANEXT WHERE ID_FCCTAEXT = ?',
            [conta],
            {
              teto: 1,
            },
          );
          itens = ls.map((l) => ({ id: num(l['ID']), versao: versaoDaLinhaFaturamento(l['C'] ?? null) }));
          return;
        }
        default:
          throw new Error(`Cenário ${chave} sem reprodução.`);
      }
    },
    async executar(e) {
      const versao = await versaoConta(e, conta);
      switch (chave) {
        case 'faturamento.fecharConta/externa-emitida':
        case 'faturamento.fecharConta/internacao-emitida':
        case 'faturamento.fecharConta/conta-pacote-c':
          await executar(e, { conta, versao });
          return;
        case 'faturamento.fecharConta/nao-emitida':
          await exigirRecusa(executar(e, { conta, versao }), 'nao-emitida');
          return;
        case 'faturamento.fecharConta/total-diverge':
          await exigirRecusa(executar(e, { conta, versao }), 'total-diverge');
          return;
        case 'faturamento.fecharConta/procedimento-fora-da-tabela':
          await exigirRecusa(executar(e, { conta, versao }), 'procedimento-fora-da-tabela');
          return;
        case 'faturamento.fecharConta/com-pendencia-bloqueante':
          await exigirRecusa(executar(e, { conta, versao }), 'com-pendencia-bloqueante');
          return;
        case 'faturamento.reabrirConta/fechada-s':
          await executar(e, { conta, versao, motivo: 'sghrepro: item lançado depois do fechamento' });
          return;
        case 'faturamento.reabrirConta/apresentada-a':
          await exigirRecusa(
            executar(e, { conta, versao, motivo: 'sghrepro: tentativa na apresentada' }),
            'conta-apresentada',
          );
          return;
        case 'faturamento.reabrirConta/em-lote':
          await exigirRecusa(
            executar(e, { conta, versao, motivo: 'sghrepro: tentativa em lote' }),
            'em-lote',
          );
          return;
        case 'faturamento.conferirItem/um-item':
        case 'faturamento.conferirItem/bloco':
          await executar(e, { conta, itens });
          return;
        case 'faturamento.conferirItem/conta-fechada':
          await exigirRecusa(executar(e, { conta, itens }), 'conta-fechada');
          return;
        default:
          throw new Error(`Cenário ${chave} sem reprodução.`);
      }
    },
  };
}
