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

    it('procedimentos da especialidade: total igual à contagem do banco, página e ordem por código', async () => {
      const c = contextoPorta(m!);
      const x = await um<{ cod: unknown; n: unknown }>(
        `SELECT CAST(em.codigo AS UNSIGNED) AS cod, COUNT(DISTINCT i.id) AS n
         FROM especialidade_procedimento ep JOIN especialidade_medica em ON em.id = ep.especialidade_medica_id
         JOIN item_faturavel i ON i.id = ep.item_faturavel_id
        WHERE em.codigo REGEXP '^[0-9]{1,2}$' AND ep.ativo AND ep.excluido_em IS NULL AND i.codigo REGEXP '^[0-9]{1,15}$'
          AND ep.vigencia_inicio <= CURRENT_DATE AND (ep.vigencia_fim IS NULL OR ep.vigencia_fim >= CURRENT_DATE)
        GROUP BY cod ORDER BY n DESC LIMIT 1`,
        [],
      );
      if (!x) {
        expect(await porta.procedimentosDaEspecialidade(c, 99, 1, 30)).toEqual({ itens: [], total: 0 });
        return;
      }
      const r = await porta.procedimentosDaEspecialidade(c, Number(x.cod), 1, 30);
      expect(r.total).toBe(Number(x.n));
      expect(r.itens.length).toBe(Math.min(30, Number(x.n)));
      const cods = r.itens.map((i) => i.procedimento);
      expect([...cods].sort((p, q) => p - q)).toEqual(cods);
      expect((await porta.procedimentosDaEspecialidade(c, Number(x.cod), 10_000, 30)).itens).toEqual([]);
    });
  },
);
