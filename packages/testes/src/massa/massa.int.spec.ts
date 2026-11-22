// Integração da massa sintética e da concorrência na prescrição contra o MariaDB real (cliente f22_o5, criado pelo
// `python3 -I tools/db/criar_cliente.py`). Tudo roda em transação DESFEITA (escrever(..., confirmar=false)): nada fica
// no banco. Só contagens e identificadores; nenhum valor de pessoa. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checarEmOutraEstacao,
  horarioPendente,
  marcasContaEstoque,
  prescricoesDepoisDe,
  rastroDosHorarios,
  semContaNemEstoque,
  suspenderItemEmOutraEstacao,
  suspensaoDaPrescricao,
  suspensaoIncompleta,
  travarHorario,
  travarPrescricao,
} from './concorrencia-prescricao.js';
import {
  cepCompleto,
  cepInexistente,
  cpfLivre,
  estabelecimentoSintetico,
  estabelecimentosAtivos,
  loginExiste,
  loginLivre,
  MARCA_SINTETICA,
  outroCepCompleto,
  papelSintetico,
  perfilSintetico,
} from './sintetica.js';
import { entradaSintetica, prescricaoSintetica } from './prescricao-sintetica.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CODIGO = 'f22o5l08';

describe.skipIf(SEM_BANCO)('massa sintética e concorrência contra o MariaDB (cliente f22_o5)', () => {
  let nucleo: NucleoProprio;

  /** Roda e desfaz: a massa nunca fica no banco. */
  const desfeito = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'massa-f22-05-08' }, fn, false);

  beforeAll(() => {
    nucleo = new NucleoProprio();
  });
  afterAll(async () => {
    await nucleo?.encerrar?.();
  });

  it('usuário sintético com papel, perfil e estabelecimento, com vigência; nada fica', async () => {
    const login = await desfeito(async (e) => {
      const login = await loginLivre(e, Date.now() % 1_000_000);
      expect(await loginExiste(e, login)).toBe(false);
      const est = await e.inserir(
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, NOW(3))',
        [CODIGO, `Hospital ${MARCA_SINTETICA}`, `Hospital ${MARCA_SINTETICA} (fictício)`],
      );
      await e.inserir(
        `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'integracao', NOW(3))`,
        [login, `USUARIO ${MARCA_SINTETICA}`],
      );
      await e.inserir('INSERT INTO papel_seguranca (codigo, nome, criado_em) VALUES (?, ?, NOW(3))', [
        CODIGO,
        `Papel ${MARCA_SINTETICA}`,
      ]);
      await e.inserir('INSERT INTO perfil_acesso (codigo, nome, criado_em) VALUES (?, ?, NOW(3))', [
        CODIGO,
        `Perfil ${MARCA_SINTETICA}`,
      ]);
      await papelSintetico(e, login, CODIGO);
      await perfilSintetico(e, login, CODIGO, est);
      await estabelecimentoSintetico(e, login, est);
      expect(await loginExiste(e, login)).toBe(true);
      expect(await estabelecimentosAtivos(e, 20)).toContain(est);
      const [n] = await e.consultar<{ p: number; f: number; s: number }>(
        `SELECT (SELECT COUNT(*) FROM usuario_papel_seguranca x JOIN usuario u ON u.id = x.usuario_id WHERE u.login = ?) AS p,
                (SELECT COUNT(*) FROM usuario_perfil x JOIN usuario u ON u.id = x.usuario_id WHERE u.login = ?) AS f,
                (SELECT COUNT(*) FROM usuario_estabelecimento x JOIN usuario u ON u.id = x.usuario_id WHERE u.login = ?) AS s`,
        [login, login, login],
      );
      expect([Number(n?.p), Number(n?.f), Number(n?.s)]).toEqual([1, 1, 1]);
      // Recusa: código de papel inexistente.
      await expect(papelSintetico(e, login, `${CODIGO}x`)).rejects.toThrow('Código inexistente');
      return login;
    });
    const ficou = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'massa-f22-05-08' }, (l) =>
      loginExiste(l, login),
    );
    expect(ficou).toBe(false);
  });

  it('CPF livre e CEP do catálogo próprio', async () => {
    await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'massa-f22-05-08' }, async (l) => {
      const cpf = await cpfLivre(l, 4242);
      expect(cpf).toMatch(/^9\d{10}$/);
      const inexistente = await cepInexistente(l);
      expect(await l.consultar('SELECT id FROM logradouro_cep WHERE codigo_cep = ?', [inexistente])).toEqual(
        [],
      );
      const [c] = await l.consultar<{ n: number }>(
        `SELECT COUNT(*) AS n FROM logradouro_cep WHERE ativo = TRUE AND tipo_cep = 'logradouro'
           AND logradouro IS NOT NULL AND bairro_id IS NOT NULL AND especie_logradouro_id IS NOT NULL`,
      );
      if (Number(c?.n) > 0) {
        const cep = await cepCompleto(l);
        expect(cep).toMatch(/^\d{8}$/);
        await outroCepCompleto(l, cep).catch((x: Error) =>
          expect(x.message).toBe('Nenhum outro CEP completo.'),
        );
      } else {
        // Catálogo de CEPs não carregado neste cliente: a função recusa com a mensagem de negócio.
        await expect(cepCompleto(l)).rejects.toThrow('Nenhum CEP completo');
        await expect(outroCepCompleto(l, inexistente)).rejects.toThrow('Nenhum outro CEP completo');
      }
    });
  });

  it('perfil de acesso: só o do estabelecimento pedido ou da rede, nunca o de outro estabelecimento', async () => {
    await desfeito(async (e) => {
      const login = await loginLivre(e, (Date.now() + 7) % 1_000_000);
      const estab = (c: string) =>
        e.inserir(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, NOW(3))',
          [c, `Hospital ${MARCA_SINTETICA}`, `Hospital ${MARCA_SINTETICA} (fictício)`],
        );
      const a = await estab(`${CODIGO}a`);
      const b = await estab(`${CODIGO}b`);
      const c = await estab(`${CODIGO}c`);
      await e.inserir(
        `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'integracao', NOW(3))`,
        [login, `USUARIO ${MARCA_SINTETICA}`],
      );
      // O mesmo código em dois estabelecimentos (a e b); nenhum perfil de rede com esse código.
      const perfil = (est: number) =>
        e.inserir(
          'INSERT INTO perfil_acesso (codigo, nome, estabelecimento_id, criado_em) VALUES (?, ?, ?, NOW(3))',
          [CODIGO, `Perfil ${MARCA_SINTETICA}`, est],
        );
      const pa = await perfil(a);
      const pb = await perfil(b);
      await perfilSintetico(e, login, CODIGO, b);
      const ls = await e.consultar<{ p: number; s: number }>(
        `SELECT x.perfil_acesso_id AS p, x.estabelecimento_id AS s FROM usuario_perfil x
           JOIN usuario u ON u.id = x.usuario_id WHERE u.login = ?`,
        [login],
      );
      expect(ls.map((x) => [Number(x.p), Number(x.s)])).toEqual([[pb, b]]);
      expect(pa).not.toBe(pb);
      // No terceiro estabelecimento não há perfil com o código: recusa, em vez de conceder o perfil alheio.
      await expect(perfilSintetico(e, login, CODIGO, c)).rejects.toThrow('Código inexistente');
    });
  });

  it('concorrência: efeito real sobre uma prescrição sintética (transação desfeita)', async () => {
    await desfeito(async (e) => {
      const m = await prescricaoSintetica(e, `${CODIGO}p`, Date.now() % 1_000_000);
      const versao = async (tabela: 'prescricao_item' | 'horario_administracao', id: number) => {
        const [x] = await e.consultar<{ v: number; s: Date | null }>(
          tabela === 'prescricao_item'
            ? 'SELECT versao AS v, suspenso_em AS s FROM prescricao_item WHERE id = ?'
            : 'SELECT versao AS v, suspenso_em AS s FROM horario_administracao WHERE id = ?',
          [id],
        );
        return { v: Number(x?.v), suspenso: x?.s != null };
      };
      const todos = [m.horarioVencido, m.horarioFuturo, m.horarioAdministrado];

      // (d) O horário pendente e vencido é exatamente o montado.
      expect(await horarioPendente(e, m.estabelecimento)).toEqual({
        horario: m.horarioVencido,
        item: m.item,
        prescricao: m.prescricao,
        atendimento: m.atendimento,
        paciente: m.paciente,
      });
      expect(await rastroDosHorarios(e, todos)).toEqual([0, 1]);

      // (e) Antes de qualquer movimento: sem conta, sem estoque, saldo igual.
      const antes = await marcasContaEstoque(e, m.estabelecimento, [m.insumo]);
      expect(await semContaNemEstoque(e, m.estabelecimento, antes, [m.insumo])).toEqual({
        conta: 0,
        movimento: 0,
        saldoIgual: true,
      });

      // (c) A outra estação checa: 1 linha, versão +1, evento 'checagem'; a segunda vez não altera nada.
      const h0 = await versao('horario_administracao', m.horarioVencido);
      const checagem = {
        profissional: m.profissional,
        situacaoChecagem: m.situacaoAdministrado,
        usuario: m.usuario,
      };
      expect(await checarEmOutraEstacao(e, m.horarioVencido, checagem)).toBe(1);
      expect((await versao('horario_administracao', m.horarioVencido)).v).toBe(h0.v + 1);
      expect(await checarEmOutraEstacao(e, m.horarioVencido, checagem)).toBe(0);
      expect(await rastroDosHorarios(e, todos)).toEqual([1, 2]);
      expect(await horarioPendente(e, m.estabelecimento)).toBeNull();

      // (b) A outra estação suspende o item: item e só a dose pendente (a futura) com versão +1 e suspenso_em.
      const i0 = await versao('prescricao_item', m.item);
      const f0 = await versao('horario_administracao', m.horarioFuturo);
      const a0 = await versao('horario_administracao', m.horarioAdministrado);
      const v0 = await versao('horario_administracao', m.horarioVencido);
      const suspensao = {
        profissional: m.profissional,
        motivo: `Suspensão ${MARCA_SINTETICA}`,
        usuario: m.usuario,
      };
      expect(await suspenderItemEmOutraEstacao(e, m.item, suspensao)).toBe(1);
      expect(await versao('prescricao_item', m.item)).toEqual({ v: i0.v + 1, suspenso: true });
      expect(await versao('horario_administracao', m.horarioFuturo)).toEqual({ v: f0.v + 1, suspenso: true });
      // As doses já administradas não mudam.
      expect(await versao('horario_administracao', m.horarioAdministrado)).toEqual(a0);
      expect(await versao('horario_administracao', m.horarioVencido)).toEqual(v0);
      const [it0] = await e.consultar<{ p: number; m: string | null }>(
        'SELECT suspensao_profissional_id AS p, motivo_suspensao AS m FROM prescricao_item WHERE id = ?',
        [m.item],
      );
      expect([Number(it0?.p), it0?.m != null]).toEqual([m.profissional, true]);
      expect(await rastroDosHorarios(e, todos)).toEqual([2, 2]);
      // Item já suspenso: nada muda; horário suspenso não é checado.
      expect(await suspenderItemEmOutraEstacao(e, m.item, suspensao)).toBe(0);
      expect(await checarEmOutraEstacao(e, m.horarioFuturo, checagem)).toBe(0);
      expect(await rastroDosHorarios(e, todos)).toEqual([2, 2]);

      // Travas e leituras sobre as linhas reais.
      expect(await travarPrescricao(e, m.prescricao)).toBe(true);
      expect(await travarHorario(e, m.horarioFuturo)).toBe(true);
      expect(await prescricoesDepoisDe(e, m.atendimento, m.prescricao)).toBe(0);

      // (a) A suspensão da prescrição sem o momento é recusada pelo CHECK ck_prescricao_10; nada muda.
      await expect(suspensaoIncompleta(e, m.prescricao)).rejects.toThrow(/ck_prescricao_10/);
      expect(await suspensaoDaPrescricao(e, m.prescricao)).toEqual({
        situacao: 'vigente',
        suspensaEm: null,
        motivo: null,
      });

      // (e) Ainda sem conta nem estoque; um movimento inserido é acusado (contagem e saldo).
      expect(await semContaNemEstoque(e, m.estabelecimento, antes, [m.insumo])).toEqual({
        conta: 0,
        movimento: 0,
        saldoIgual: true,
      });
      await entradaSintetica(e, m);
      expect(await semContaNemEstoque(e, m.estabelecimento, antes, [m.insumo])).toEqual({
        conta: 0,
        movimento: 1,
        saldoIgual: false,
      });
    });
  });
});
