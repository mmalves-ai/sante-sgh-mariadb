// Integração do M38 na cópia (ficha, campo 1, campo 6 e campo 9; cap-14 §14.2.6), tudo em transação DESFEITA:
//   (1) a trilha dupla gravada pelo executor (login OK, login falho, fim de sessão, bloqueio, desbloqueio e consulta
//       de prontuário, com usuário e paciente sintéticos) aparece nas gravações do dia pela SGH_TRILHA;
//   (2) a vigilância recalcula a estrutura de cada gravação no banco (só preenchida e confere: nenhum valor volta) e
//       compara com a referência vigente de cada cenário: 0 divergência;
//   (3) a linha do dia vai a SGH_CFG_COEX_VIGIA e volta igual, sem nenhum valor de linha;
//   (4) uma gravação adulterada na transação (o fuso fixo trocado, o paciente preenchido no cabeçalho) é apontada,
//       com a tabela, a coluna e o tipo da classe.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Assinatura, esquemaAssinatura } from '@sgh/contratos';
import {
  CENARIO_DO_TIPO_EVENTO,
  comparacoesDaReferencia,
  vigiarDia,
  vigiarHospitalDia,
} from '@sgh/dominio-config';
import {
  carregarDominiosVistos,
  type Escritor,
  gravarResultadoVigia,
  lerEstruturaGravacao,
  lerGravacoesTrilhaDoDia,
  lerResultadosVigia,
  LOCALIZADORES_VIGIA,
  operacao,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  atendimentoExistente,
  cepCompleto,
  cpfLivre,
  ESTACAO_SINTETICA,
  loginLivre,
  pacienteSintetico,
  papelSintetico,
  usuarioSintetico,
} from '../massa/sintetica.js';
import { adulterarEventoTrilha } from '../massa/vigia-outro-sistema.js';
import { type Ambiente, ctx, ctxOperacao, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const OP = 'auditoria.registrarEventoLegado';
const PASTA = resolve(import.meta.dirname, '../../../legado/src/auditoria/assinaturas', OP);

function referencias(): Record<string, Assinatura> {
  const r: Record<string, Assinatura> = {};
  for (const f of readdirSync(PASTA).filter((x) => x.endsWith('.assinatura.json'))) {
    const a = esquemaAssinatura.parse(JSON.parse(readFileSync(resolve(PASTA, f), 'utf8')));
    if (a.tabelas.length > 0) r[a.cenario] = a;
  }
  return r;
}

const loc = LOCALIZADORES_VIGIA[OP]!;
const lerEstrutura = (e: Escritor) => (id: string, ref: Assinatura) =>
  lerEstruturaGravacao(e, loc, id, {
    TBCABTRILHA: comparacoesDaReferencia(ref, 'TBCABTRILHA'),
    TBLANTRILHASGH: comparacoesDaReferencia(ref, 'TBLANTRILHASGH'),
  });

const tiposLogradouro = () =>
  carregarDominiosVistos(resolve(import.meta.dirname, '../../../legado/src')).vistos('RICADPAC', 'TPLGR') ??
  new Set<string>();

describe.skipIf(!PODE_ESCREVER)('vigilância diária de gravação na cópia (M38)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  }, 120_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  /** Grava os eventos da trilha dupla pelo executor e devolve os IDs de TBCABTRILHA e o dia da SGH_TRILHA. */
  async function gravarEventos(e: Escritor): Promise<{ ids: string[]; dia: string; paciente: number }> {
    const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
    await a.executor.executar(
      operacao('acesso.criarUsuarioIntegracao'),
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      { escritor: e },
    );
    await papelSintetico(e, login);
    const cpf = await cpfLivre(e, Date.now() % 90_000_000);
    const cep = await cepCompleto(e, tiposLogradouro());
    const pac = await a.executor.executar(
      operacao('cadastro.cadastrarPaciente'),
      a.cod,
      pacienteSintetico('minimo', cpf, cep),
      ctxOperacao(a, login),
      { escritor: e },
    );
    const eventos = [
      { tipo: 6, criticidade: 7, opcao: 5416 },
      { tipo: 7, criticidade: 4, opcao: 5416 },
      { tipo: 10, criticidade: 7, opcao: 5417 },
      { tipo: 8, criticidade: 7, opcao: 5143 },
      { tipo: 9, criticidade: 7, opcao: 5144 },
      {
        tipo: 1,
        criticidade: 7,
        opcao: 5146,
        atendimento: await atendimentoExistente(e),
        alvos: [{ tabelaCampo: 'RICADPAC.ID', id: Number(pac.resultado['idPaciente']) }],
      },
    ];
    const ids: string[] = [];
    for (const ev of eventos) {
      const r = await a.executor.executar(
        operacao(OP),
        a.cod,
        { ...ev, estacao: ESTACAO_SINTETICA },
        ctxOperacao(a, login),
        { escritor: e },
      );
      ids.push(String(r.resultado['idTrilha']));
    }
    const [d] = await e.consultar<{ DIA: Date }>('SELECT DIA FROM SGH_TRILHA WHERE ID_TBCABTRILHA = ?', [
      ids[0],
    ]);
    return {
      ids,
      dia: (d?.DIA as Date).toISOString().slice(0, 10),
      paciente: Number(pac.resultado['idPaciente']),
    };
  }

  it('a trilha dupla do dia confere com a referência; a linha do dia volta sem valor de linha', async () => {
    const refs = referencias();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const { ids, dia } = await gravarEventos(e);
      const doDia = await lerGravacoesTrilhaDoDia(e, a.cod, dia, OP);
      // O cadastro do paciente sintético (tipo 2) gravou TBCABTRILHA na mesma transação: não é amostra de OP.
      const doCadastro = await lerGravacoesTrilhaDoDia(e, a.cod, dia, 'cadastro.cadastrarPaciente');
      const meus = doDia.filter((g) => ids.includes(g.id));
      const gravacoes = meus.map((g) => ({
        id: g.id,
        cenario: g.codigoCenario === null ? null : (CENARIO_DO_TIPO_EVENTO[g.codigoCenario] ?? null),
      }));
      const res = await vigiarDia({
        hospital: a.cod,
        data: dia,
        operacao: OP,
        tamanho: gravacoes.length,
        gravacoes,
        referencias: refs,
        lerEstrutura: lerEstrutura(e),
      });
      await gravarResultadoVigia(e, res);
      const lidas = await lerResultadosVigia(e, a.cod, dia, dia);
      const [linha] = await e.consultar<Record<string, unknown>>(
        'SELECT ELEMENTOS FROM SGH_CFG_COEX_VIGIA WHERE HOSPITAL = ? AND DIA = CAST(CAST(? AS VARCHAR(10)) AS DATE) AND OPERACAO = ?',
        [a.cod, dia, OP],
      );
      return {
        ids,
        meus: meus.length,
        cenarios: gravacoes.map((g) => g.cenario),
        res,
        lidas,
        linha,
        doCadastro: doCadastro.map((g) => g.id),
        doDia: doDia.map((g) => ({ id: g.id, tipo: g.codigoCenario })),
      };
    });
    expect(r.meus).toBe(6);
    // As gravações do dia de OP não trazem as de outra operação (sem o filtro, o tipo 2 viraria divergência).
    expect(r.doCadastro.length).toBeGreaterThan(0);
    expect(r.doDia.filter((g) => r.doCadastro.includes(g.id))).toEqual([]);
    expect(r.doDia.filter((g) => g.tipo === 2)).toEqual([]);
    expect(r.cenarios).not.toContain(null);
    expect(r.res.amostradas).toBe(6);
    expect(r.res.divergentes).toBe(0);
    expect(r.res.elementos).toEqual([]);
    expect(r.lidas.find((x) => x.resultado.operacao === OP)?.resultado).toEqual(r.res);
    expect(String(r.linha?.['ELEMENTOS'])).toBe('[]');
    console.log(
      `[${a.cod}] vigilância do dia: ${r.res.amostradas} amostrada(s), ${r.res.divergentes} divergente(s); a linha de SGH_CFG_COEX_VIGIA desfeita`,
    );
  }, 180_000);

  it('a gravação adulterada é apontada pela estrutura (tabela, coluna e tipo da classe), sem o valor', async () => {
    const refs = referencias();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const { ids, dia, paciente } = await gravarEventos(e);
      // Adultera o login OK (o primeiro) na transação: fuso fora da constante e o retrato do paciente sintético no
      // cabeçalho (o identificador fica no banco: a subconsulta não o traz para a aplicação).
      await adulterarEventoTrilha(e, ids[0]!, paciente);
      const doDia = await lerGravacoesTrilhaDoDia(e, a.cod, dia, OP);
      const meus = new Set(ids);
      return vigiarHospitalDia({
        hospital: a.cod,
        data: dia,
        tamanho: 50,
        operacoes: [OP],
        localizavel: (op) => op in LOCALIZADORES_VIGIA,
        gravacoesDoDia: async () =>
          doDia
            .filter((g) => meus.has(g.id))
            .map((g) => ({
              id: g.id,
              cenario: g.codigoCenario === null ? null : (CENARIO_DO_TIPO_EVENTO[g.codigoCenario] ?? null),
            })),
        referencias: () => refs,
        lerEstrutura: (_op, id, ref) => lerEstrutura(e)(id, ref),
        gravar: (x) => gravarResultadoVigia(e, x),
      });
    });
    const [res] = r.resultados;
    expect(res?.divergentes).toBe(1);
    expect(res?.elementos.map((x) => `${x.tipo} ${x.tabela}.${x.coluna} ${x.classe}`).sort()).toEqual([
      'classe TBCABTRILHA.FUSO_HORARIO_LOCAL constante',
      'colunas TBCABTRILHA.ID_HTPACIENTE vazio',
    ]);
    expect(JSON.stringify(res)).not.toContain('-02:00');
    expect(r.alertas).toHaveLength(1);
    console.log(`[${a.cod}] gravação adulterada: ${r.alertas[0]}`);
  }, 180_000);
});
