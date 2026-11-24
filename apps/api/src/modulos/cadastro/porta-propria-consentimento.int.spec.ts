// Integração do complemento da porta própria do cadastro (consentimentos do paciente e procedimentos da especialidade)
// contra o MariaDB real, no cliente de teste f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma
// pessoa real). O tipo de termo do balcão é garantido no catálogo do cliente (fica; é catálogo). Os termos de teste e o
// histórico saem no fim, antes da limpeza da massa.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CEP_TESTE,
  CLIENTE_F22,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { CadastroProprioConsentimento, TIPO_TERMO_BALCAO } from './porta-propria-consentimento.js';
import { PortaCadastroPropria } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

async function limparTermos(nucleo: NucleoProprio, m: Massa | null): Promise<void> {
  if (!m) return;
  await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-termos' }, async (e) => {
    await e.executar(
      'DELETE h FROM consentimento_titular_historico h JOIN consentimento_titular c ON c.id = h.consentimento_titular_id WHERE c.estabelecimento_id = ?',
      [m.estabelecimento],
    );
    await e.executar('DELETE FROM consentimento_titular WHERE estabelecimento_id = ?', [m.estabelecimento]);
  });
}

const MARCA_ESP = `${MARCA} ESP`;
const ITENS_ESP = Array.from({ length: 11 }, (_, k) => `88102010${String(k + 1).padStart(2, '0')}`);
const ITEM_NAO_NUMERICO = `${MARCA}X`;

/** Apaga a massa sintética de especialidades e itens do teste de procedimentos (vínculos primeiro, pela FK). */
async function limparEspecialidadesDe(nucleo: NucleoProprio): Promise<void> {
  const cods = [...ITENS_ESP, ITEM_NAO_NUMERICO];
  const marcas = cods.map(() => '?').join(',');
  await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-esp-limpa' }, async (e) => {
    await e.executar(
      `DELETE ep FROM especialidade_procedimento ep
         LEFT JOIN especialidade_medica em ON em.id = ep.especialidade_medica_id
         LEFT JOIN item_faturavel i ON i.id = ep.item_faturavel_id
        WHERE em.descricao LIKE ? OR i.codigo IN (${marcas})`,
      [`%${MARCA_ESP}%`, ...cods],
    );
    await e.executar(`DELETE FROM item_faturavel WHERE codigo IN (${marcas})`, cods);
    await e.executar('DELETE FROM especialidade_medica WHERE descricao LIKE ?', [`%${MARCA_ESP}%`]);
  });
}

describe.skipIf(SEM_BANCO)(
  'consentimentos e procedimentos da especialidade no banco próprio (f22_o1)',
  () => {
    let nucleo: NucleoProprio;
    let porta: CadastroProprioConsentimento;
    let m: Massa | null = null;
    let paciente = 0;

    const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f22-0102-conta' }, (l) => l.uma<T>(sql, p));
    const trilha = (): RegistroTrilhaTela => ({
      estabelecimento: m!.estabelecimento,
      usuario: m!.usuario,
      acao: 'operacao',
      entidade: 'consentimento_titular',
      entidadeId: null,
      dadosDepois: { evento: 'teste', recurso: 'cadastro.consentimento' },
      correlacao: 'f22-0102-termo',
    });

    const limparEspecialidades = () => limparEspecialidadesDe(nucleo);

    /**
     * Massa sintética: especialidade de código N (livre entre 90 e 99), a mesma com zero à esquerda ('0N', não pode se
     * fundir com N) e uma inativa; itens de código numérico fixo cobrindo vigente, duas vigências do mesmo item,
     * vencido, futuro, vínculo inativo, vínculo excluído, item inativo, item excluído e item de código não numérico.
     */
    async function prepararEspecialidades(): Promise<{ n: number; inativa: number }> {
      await limparEspecialidades();
      return nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-esp' }, async (e) => {
        const agora = new Date();
        const livres: number[] = [];
        for (let k = 90; k <= 99 && livres.length < 2; k++) {
          const x = await e.uma('SELECT id FROM especialidade_medica WHERE codigo IN (?, ?)', [String(k), `0${k}`]);
          if (!x) livres.push(k);
        }
        expect(livres.length).toBe(2);
        const [n, inativa] = livres as [number, number];
        const esp = async (codigo: string, ativo: boolean) =>
          e.inserir('INSERT INTO especialidade_medica (codigo, descricao, ativo, criado_em) VALUES (?, ?, ?, ?)', [
            codigo,
            `${codigo} ${MARCA_ESP}`,
            ativo,
            agora,
          ]);
        const eN = await esp(String(n), true);
        const eZero = await esp(`0${n}`, true);
        const eInativa = await esp(String(inativa), false);
        const g = await e.uma<{ g: unknown }>('SELECT grupo_faturamento_id AS g FROM item_faturavel WHERE id = ?', [
          m!.procedimento,
        ]);
        const grupo = Number(g?.g);
        const item = async (codigo: string, letra: string, situacao = 'ativo', excluido = false) =>
          e.inserir(
            `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, situacao, inativado_em, excluido_em, criado_em)
             VALUES (?, ?, 'procedimento', ?, ?, ?, ?, ?)`,
            [
              codigo,
              `PROC ${letra} ${MARCA_ESP}`,
              grupo,
              situacao,
              situacao === 'ativo' ? null : '2025-01-01',
              excluido ? agora : null,
              agora,
            ],
          );
        const [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11] = ITENS_ESP as unknown as string[];
        const iB = await item(c1!, 'B');
        const iC = await item(c2!, 'C');
        const iA = await item(c3!, 'A');
        const iD = await item(c4!, 'D');
        const iE = await item(c5!, 'E');
        const iF = await item(c6!, 'F');
        const iG = await item(c7!, 'G');
        const iH = await item(c8!, 'H', 'inativo');
        const iI = await item(c9!, 'I', 'ativo', true);
        const iK = await item(c10!, 'K');
        const iL = await item(c11!, 'L');
        const iJ = await item(ITEM_NAO_NUMERICO, 'J');
        const vinc = async (
          espId: number,
          itemId: number,
          inicio: string,
          fim: string | null = null,
          ativo = true,
          excluido = false,
        ) =>
          e.inserir(
            `INSERT INTO especialidade_procedimento
               (especialidade_medica_id, item_faturavel_id, vigencia_inicio, vigencia_fim, ativo, excluido_em, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [espId, itemId, inicio, fim, ativo, excluido ? agora : null, agora],
          );
        await vinc(eN, iA, '2020-01-01');
        await vinc(eN, iB, '2020-01-01');
        await vinc(eN, iC, '2020-01-01');
        await vinc(eN, iC, '2021-01-01');
        await vinc(eN, iC, '2018-01-01', '2018-12-31');
        await vinc(eN, iD, '2019-01-01', '2019-12-31');
        await vinc(eN, iE, '2099-01-01');
        await vinc(eN, iF, '2020-01-01', null, false);
        await vinc(eN, iG, '2020-01-01', null, true, true);
        await vinc(eN, iH, '2020-01-01');
        await vinc(eN, iI, '2020-01-01');
        await vinc(eN, iJ, '2020-01-01');
        await vinc(eN, iL, '2020-01-01');
        await vinc(eZero, iK, '2020-01-01');
        await vinc(eInativa, iA, '2020-01-01');
        return { n, inativa };
      });
    }

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      expect((await nucleo.cliente(CLIENTE_F22)).banco).toBe(`cliente_${CLIENTE_F22}`);
      m = await prepararMassa(nucleo);
      await limparTermos(nucleo, m);
      await limparMassa(nucleo, m);
      await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-termo-tipo' }, async (e) => {
        const x = await e.uma('SELECT id FROM tipo_termo_lgpd WHERE codigo = ?', [TIPO_TERMO_BALCAO]);
        if (!x)
          await e.inserir(
            "INSERT INTO tipo_termo_lgpd (codigo, descricao, ativo, finalidade, criado_em) VALUES (?, 'CONSENTIMENTO NO BALCAO', TRUE, 'consentimento', ?)",
            [TIPO_TERMO_BALCAO, new Date()],
          );
      });
      const cadastro = new PortaCadastroPropria(nucleo, CLIENTE_F22);
      const r = await cadastro.cadastrar(
        contextoPorta(m),
        {
          nome: `PACIENTE TERMO ${MARCA}`,
          nascimento: '1980-05-17',
          sexo: 'F',
          cpf: cpfSintetico('990102091'),
          nomeMae: `MAE ${MARCA}`,
          naturalidade: 'BELO HORIZONTE',
          ufNaturalidade: 'MG',
          cep: CEP_TESTE,
          numero: 100,
          celular: '31999990102',
          contatoNome: `CONTATO ${MARCA}`,
          contatoTelefone: '3133330102',
        },
        contextoGravacao(m),
      );
      paciente = r.resultado.idPaciente;
      porta = new CadastroProprioConsentimento(nucleo, CLIENTE_F22);
    }, 120_000);

    afterAll(async () => {
      await limparEspecialidadesDe(nucleo).catch(() => undefined);
      await limparTermos(nucleo, m).catch(() => undefined);
      await limparMassa(nucleo, m).catch(() => undefined);
      await nucleo?.encerrar();
    });

    it('opções com os códigos da tela', async () => {
      const o = await porta.opcoesConsentimento();
      expect(o.situacoes.map((x) => x.codigo)).toEqual([3, 4]);
      expect(o.signatarios.map((x) => x.codigo)).toEqual([1, 2]);
      expect(o.revogacoes.map((x) => x.codigo)).toEqual([2]);
    });

    it('registra o termo (número, histórico, trilha) e lista do mais recente; revoga sem apagar', async () => {
      const c = contextoPorta(m!);
      const base = { idPaciente: paciente, pront: 0, usuario: 'X', signatario: 1 };
      const a = await porta.registrarConsentimento(
        c,
        { ...base, finalidade: 'Tratamento de dados', versao: 'v1', situacao: 3 },
        trilha(),
      );
      const b = await porta.registrarConsentimento(
        c,
        { ...base, finalidade: 'Pesquisa', versao: 'v2', situacao: 4 },
        trilha(),
      );
      const termo = await um<{ numero: unknown; canal_registro: unknown; situacao: unknown }>(
        'SELECT numero, canal_registro, situacao FROM consentimento_titular WHERE id = ?',
        [a],
      );
      expect(String(termo?.numero)).toMatch(/^TC-/);
      expect(termo).toMatchObject({ canal_registro: 'balcao', situacao: 'autorizado' });
      let l = await porta.consentimentos(c, paciente);
      expect(l.map((x) => x.id)).toEqual([b, a]);
      expect(l[1]).toMatchObject({
        finalidade: 'Tratamento de dados',
        versao: 'v1',
        situacao: 3,
        signatario: 1,
        revogadoEm: null,
        revogacao: null,
      });
      expect(l[0]).toMatchObject({ situacao: 4 });
      await porta.revogarConsentimento(c, { idPaciente: paciente, id: a, motivo: 2, usuario: 'X' }, trilha());
      l = await porta.consentimentos(c, paciente);
      expect(l[1]).toMatchObject({ id: a, situacao: 3, revogacao: 2 });
      expect(l[1]?.revogadoEm).not.toBeNull();
      const h = await um<{ n: unknown }>(
        'SELECT COUNT(*) AS n FROM consentimento_titular_historico WHERE consentimento_titular_id = ?',
        [a],
      );
      expect(Number(h?.n)).toBe(2);
      const t = await um<{ n: unknown }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'consentimento_titular' AND entidade_id IN (?, ?)",
        [a, b],
      );
      expect(Number(t?.n)).toBeGreaterThanOrEqual(3);
      await expect(
        porta.revogarConsentimento(c, { idPaciente: paciente, id: a, motivo: 2, usuario: 'X' }, trilha()),
      ).rejects.toMatchObject({ problema: { codigo: 'consentimento-revogado' } });
    });

    it('recusas: situação, signatário, motivo, representante sem responsável legal e paciente inexistente', async () => {
      const c = contextoPorta(m!);
      const base = { idPaciente: paciente, pront: 0, usuario: 'X', finalidade: 'F', versao: 'v1' };
      await expect(
        porta.registrarConsentimento(c, { ...base, situacao: 9, signatario: 1 }, trilha()),
      ).rejects.toMatchObject({
        problema: { codigo: 'situacao-invalida' },
      });
      await expect(
        porta.registrarConsentimento(c, { ...base, situacao: 3, signatario: 7 }, trilha()),
      ).rejects.toMatchObject({
        problema: { codigo: 'signatario-invalido' },
      });
      await expect(
        porta.registrarConsentimento(c, { ...base, situacao: 3, signatario: 2 }, trilha()),
      ).rejects.toMatchObject({
        problema: { codigo: 'representante-ausente' },
      });
      await expect(
        porta.registrarConsentimento(
          c,
          { ...base, idPaciente: 999_999_999_9, situacao: 3, signatario: 1 },
          trilha(),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'paciente-inexistente' } });
      await expect(
        porta.revogarConsentimento(c, { idPaciente: paciente, id: 1, motivo: 5, usuario: 'X' }, trilha()),
      ).rejects.toMatchObject({ problema: { codigo: 'motivo-invalido' } });
      expect((await porta.consentimentos(c, paciente)).length).toBe(2);
    });

    it('procedimentos da especialidade: só vigente, ativo e vivo, código exato, sem repetição, ordem e página fixas', async () => {
      const c = contextoPorta(m!);
      const esp = await prepararEspecialidades();
      try {
        // Esperado: 001, 002 (duas vigências, uma linha), 003 e 011; os demais casos ficam de fora.
        const p1 = await porta.procedimentosDaEspecialidade(c, esp.n, 1, 2);
        expect(p1).toEqual({
          total: 4,
          itens: [
            { procedimento: 8810201001, descricao: `PROC B ${MARCA_ESP}` },
            { procedimento: 8810201002, descricao: `PROC C ${MARCA_ESP}` },
          ],
        });
        const p2 = await porta.procedimentosDaEspecialidade(c, esp.n, 2, 2);
        expect(p2).toEqual({
          total: 4,
          itens: [
            { procedimento: 8810201003, descricao: `PROC A ${MARCA_ESP}` },
            { procedimento: 8810201011, descricao: `PROC L ${MARCA_ESP}` },
          ],
        });
        expect(await porta.procedimentosDaEspecialidade(c, esp.n, 3, 2)).toEqual({ itens: [], total: 4 });
        const tudo = await porta.procedimentosDaEspecialidade(c, esp.n, 1, 30);
        expect(tudo.itens.map((x) => x.procedimento)).toEqual([8810201001, 8810201002, 8810201003, 8810201011]);
        // Especialidade inativa não lista nada, mesmo com procedimento vigente.
        expect(await porta.procedimentosDaEspecialidade(c, esp.inativa, 1, 30)).toEqual({ itens: [], total: 0 });
      } finally {
        await limparEspecialidades();
      }
    });
  },
);
