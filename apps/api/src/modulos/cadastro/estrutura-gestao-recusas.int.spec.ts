// Contrato de efeito das recusas da estrutura (F3.1-13, 02-CAD linha 27) no banco do cliente de teste: a recusa leva
// TODOS os motivos de uma vez (`regras`, com a mensagem de cada um) e não deixa nada gravado.
// - gravação do setor com três erros (sem centro de custo, ramal fora do formato e ramal repetido): os três motivos,
//   nenhum setor nem ramal criado;
// - inativação do setor com filho ativo e data futura: os dois motivos, o setor continua ativo e sem data;
// - recusa de um motivo só (código repetido, motivo curto): a lista traz esse motivo com a mensagem.
// Dados sintéticos.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EstruturaGestaoPropria } from './estrutura-gestao-proprio.js';
import {
  CLIENTE_F22,
  contextoPorta,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import type { RegistroTrilhaTela } from './tipos.js';

const COR = 'f3-1-13-recusas';
const COD = `${MARCA}R`;

describe.skipIf(SEM_BANCO)('recusas da estrutura com todos os motivos (banco próprio)', () => {
  let nucleo: NucleoProprio;
  let es: EstruturaGestaoPropria;
  let m: Massa | null = null;

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => l.uma<T>(sql, p));
  const conta = async (sql: string, p: readonly unknown[]) => Number((await um<{ n: unknown }>(sql, p))!.n);
  const t = (entidade: string): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.estrutura' },
    correlacao: COR,
  });
  const c = () => contextoPorta(m!, COR);
  const versao = async (id: number) =>
    Number((await um<{ versao: unknown }>('SELECT versao FROM setor_funcional WHERE id = ?', [id]))!.versao);
  /** Os motivos da recusa, como a API os devolve à tela. */
  const recusada = async (p: Promise<unknown>) => {
    const e = await p.then(
      () => null,
      (x: unknown) => x as { problema?: { codigo?: string; detail?: string; regras?: unknown } },
    );
    expect(e?.problema, 'a gravação devia ter sido recusada').toBeTruthy();
    return e!.problema as {
      codigo: string;
      detail: string;
      regras: { codigo: string; mensagem: string }[];
    };
  };

  async function limparMinhas(): Promise<void> {
    if (!m) return;
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      const p = [m!.estabelecimento, `${COD}%`];
      await e.executar(
        `DELETE r FROM ramal_setor r JOIN setor_funcional s ON s.id = r.setor_funcional_id
          WHERE s.estabelecimento_id = ? AND s.codigo LIKE ?`,
        p,
      );
      await e.executar(
        `DELETE r FROM responsavel_setor_funcional r JOIN setor_funcional s ON s.id = r.setor_funcional_id
          WHERE s.estabelecimento_id = ? AND s.codigo LIKE ?`,
        p,
      );
      await e.executar(
        'UPDATE setor_funcional SET setor_superior_id = NULL WHERE estabelecimento_id = ? AND codigo LIKE ?',
        p,
      );
      await e.executar('DELETE FROM setor_funcional WHERE estabelecimento_id = ? AND codigo LIKE ?', p);
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMinhas();
    es = new EstruturaGestaoPropria(nucleo, CLIENTE_F22);
  });

  afterAll(async () => {
    if (!m) return;
    await limparMinhas();
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  const ramal = (numero: string) => ({
    id: null,
    ramal: numero,
    contato: null,
    principal: false,
    responsavel: false,
    telefoneExterno: null,
    observacao: null,
  });
  const base = () => ({
    id: null,
    versao: null,
    codigo: `${COD}S1`,
    nome: `Setor ${MARCA} recusas`,
    sigla: null,
    tipo: 'assistencial',
    superior: null,
    unidade: m!.unidade,
    centroCusto: m!.centroCusto,
    responsavel: null,
    responsavelInicio: null,
    responsavelFim: null,
    podeSolicitarExames: false,
    aceitaLancamentoConta: true,
    producaoFaturada: false,
    exigeProfissionalAgendamento: false,
    exigeRecursoAgendamento: false,
    siglaAgendamento: null,
    observacaoAgendamento: null,
    ramais: [ramal('2001')],
  });

  it('gravação do setor com três erros: os três motivos de uma vez e nada gravado', async () => {
    const p = await recusada(
      es.gravarSetor(
        c(),
        { ...base(), centroCusto: null, ramais: [ramal('2001'), ramal('2001'), ramal('9')] },
        t('x'),
      ),
    );
    const codigos = p.regras.map((r) => r.codigo);
    expect(codigos).toEqual(
      expect.arrayContaining(['lancamento-sem-centro-custo', 'ramal-repetido', 'ramal-invalido']),
    );
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(p.codigo).toBe(codigos[0]);
    // Cada motivo vem com a frase em português (nunca o código cru) e o detalhe junta todas.
    for (const r of p.regras) {
      expect(r.mensagem).not.toBe(r.codigo);
      expect(r.mensagem.length).toBeGreaterThan(10);
      expect(p.detail).toContain(r.mensagem);
    }
    expect(
      await conta(
        'SELECT COUNT(*) AS n FROM setor_funcional WHERE estabelecimento_id = ? AND codigo LIKE ?',
        [m!.estabelecimento, `${COD}%`],
      ),
    ).toBe(0);
  });

  it('inativar com filho ativo e data futura: os dois motivos; o setor continua ativo; um motivo só também vem na lista', async () => {
    const pai = await es.gravarSetor(c(), base(), t('x'));
    await es.gravarSetor(
      c(),
      { ...base(), codigo: `${COD}S2`, nome: `Setor ${MARCA} filho`, superior: pai, ramais: [] },
      t('x'),
    );
    const p = await recusada(
      es.situacaoSetor(
        c(),
        {
          id: pai,
          versao: await versao(pai),
          ativo: false,
          data: '2099-01-01',
          motivo: 'Setor desativado na reforma',
        },
        t('x'),
      ),
    );
    expect(p.regras.map((r) => r.codigo).sort()).toEqual(['inativacao-futura', 'setor-com-filhos-ativos']);
    expect(p.regras.every((r) => r.mensagem.length > 10)).toBe(true);
    const depois = await um('SELECT ativo, data_inativacao FROM setor_funcional WHERE id = ?', [pai]);
    expect(Number(depois!['ativo'])).toBe(1);
    expect(depois!['data_inativacao']).toBeNull();

    // Um motivo só, das recusas conferidas no banco (código repetido) e da entrada (motivo curto).
    const repetido = await recusada(es.gravarSetor(c(), { ...base(), ramais: [] }, t('x')));
    expect(repetido.regras).toEqual([{ codigo: 'codigo-repetido', mensagem: repetido.detail }]);
    const curto = await recusada(
      es.situacaoSetor(
        c(),
        { id: pai, versao: await versao(pai), ativo: false, data: null, motivo: 'curto' },
        t('x'),
      ),
    );
    expect(curto.regras).toEqual([{ codigo: 'motivo-curto', mensagem: curto.detail }]);
    expect(
      await conta(
        'SELECT COUNT(*) AS n FROM setor_funcional WHERE estabelecimento_id = ? AND codigo LIKE ?',
        [m!.estabelecimento, `${COD}%`],
      ),
    ).toBe(2);
  });
});
