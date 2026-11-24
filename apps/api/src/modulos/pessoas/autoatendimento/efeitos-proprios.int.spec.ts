// Integração dos EFEITOS da aprovação do autoatendimento contra o MariaDB do cliente de teste (f22_o3), com massa
// SINTÉTICA: o ajuste do ponto pedido e ligado à solicitação na mesma transação, a decisão do gestor (ajuste aprovado e
// solicitação aprovada juntos), a correção do cadastro com a trilha, as recusas de domínio do módulo dono (que desfazem
// o pedido inteiro), as férias sem o cálculo ligado (o gravador próprio das férias) e a porta do cadastro sem a chave do CPF (o erro
// diz o que falta, em vez de derrubar o módulo).
import { randomBytes } from 'node:crypto';
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  ctxO3,
  encerrarMassaO3,
  type MassaPessoasO3,
  prepararMassaO3,
  SEM_BANCO_O3,
} from '../avaliacao/massa.spec-util.js';
import { cifraCpfAusente, diagnosticoChaveCpf } from '../chave-cpf-ausente.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PortaPessoasPropria } from '../porta-propria.js';
import { PortaPontoPropria } from '../ponto/porta-ponto-propria.js';
import { efeitosAutoatendimentoProprios } from './efeitos-proprios.js';
import type { ContextoAutoatendimento } from './porta-autoatendimento.js';
import { PortaAutoatendimentoPropria } from './porta-propria.js';
import type { DadosSolicitacao } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const trilha = (id: number | null = null): TrilhaDaGravacao => ({
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'solicitacao_colaborador',
  entidadeId: id,
  dadosDepois: { evento: 'teste-efeito' },
  correlacao: 'teste-efeitos',
});
const erro = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ErroOperacao ? e.problema : { codigo: String(e), detail: '' };
  }
};
const pedido: DadosSolicitacao = {
  tipo: 'ajuste_ponto',
  inicio: '2026-10-20',
  fim: '2026-10-20',
  diasGozo: null,
  diasAbono: null,
  adiantaDecimo: null,
  movimento: null,
  justificativa: null,
  campo: null,
  valorAnterior: null,
  valorNovo: null,
  observacao: 'Pedido sintético dos efeitos',
};

describe.skipIf(SEM_BANCO_O3)('efeitos da aprovação do autoatendimento contra o MariaDB (f22_o3)', () => {
  let m: MassaPessoasO3;
  let porta: PortaAutoatendimentoPropria;
  let cifra: CifraCpf;
  let eu: ContextoAutoatendimento;
  let gestor: ContextoAutoatendimento;
  let justificativa: number;
  let movimento: number;
  const ler = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't' }, (l) =>
      l.consultar<Record<string, unknown>>(sql, p),
    );
  const contar = async (sql: string, p: unknown[]) => Number((await ler(sql, p))[0]?.['q'] ?? 0);
  const limparAjustes = () =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-efeitos' }, (e) =>
      e.executar('DELETE FROM ajuste_ponto WHERE estabelecimento_id IN (?, ?)', [m.est, m.outro]),
    );

  beforeAll(async () => {
    m = await prepararMassaO3('E');
    justificativa = await m.nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-teste-efeitos' },
      async (e) => {
        const j = await e.uma<{ id: number }>('SELECT id FROM justificativa_ponto WHERE codigo = ?', [
          'L0302EJ',
        ]);
        return j
          ? Number(j.id)
          : e.inserir(
              "INSERT INTO justificativa_ponto (codigo, descricao, criado_em) VALUES ('L0302EJ', 'JUSTIFICATIVA SINTETICA', ?)",
              [new Date()],
            );
      },
    );
    movimento = await m.nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-teste-efeitos' },
      async (e) => {
        const t = await e.uma<{ id: number }>('SELECT id FROM tipo_movimento_ponto WHERE codigo = ?', [
          'L0302EM',
        ]);
        return t
          ? Number(t.id)
          : e.inserir(
              "INSERT INTO tipo_movimento_ponto (codigo, descricao, natureza, criado_em) VALUES ('L0302EM', 'ABONO SINTETICO', 'abono', ?)",
              [new Date()],
            );
      },
    );
    await limparAjustes();
    cifra = new CifraCpf(randomBytes(32));
    const efeitos = efeitosAutoatendimentoProprios({
      pessoas: new PortaPessoasPropria(m.nucleo, cifra),
      ponto: new PortaPontoPropria(m.nucleo, cifra),
    });
    porta = new PortaAutoatendimentoPropria(m.nucleo, efeitos);
    eu = ctxO3(m.est, m.usuario);
    gestor = ctxO3(m.est, m.gestor);
  }, 60_000);
  afterAll(async () => {
    if (m) await limparAjustes();
    await encerrarMassaO3(m);
  });

  const solicitacoes = () =>
    contar('SELECT COUNT(*) AS q FROM solicitacao_colaborador WHERE estabelecimento_id = ?', [m.est]);

  it('ponto: o pedido e o ajuste ligados na mesma transação; a decisão aprova os dois juntos', async () => {
    const { id, ajuste } = await porta.gravarSgh(
      eu,
      (r: { id: number }) => trilha(r.id),
      async (g) => {
        const id = await g.incluirSolicitacao({ ...pedido, vinculo: m.vinculo, por: m.login });
        await g.ponto.travarPessoa(m.colaborador);
        expect(await g.ponto.eventosPeriodo(m.vinculo)).toEqual([]);
        const ajuste = await g.ponto.incluirAjuste({
          vinculo: m.vinculo,
          dia: '2026-10-20',
          tipo: 'inclusao',
          marcacao: null,
          instante: '2026-10-20T08:00',
          movimento: null,
          justificativa,
          periodo: null,
          minutos: null,
          motivo: 'Marcação esquecida (sintético)',
          por: m.login,
        });
        await g.ligarAjuste({ ajuste, solicitacao: id });
        return { id, ajuste };
      },
    );
    const [a] = await ler(
      'SELECT situacao, solicitante_usuario_id, vinculo_trabalho_id, estabelecimento_id FROM ajuste_ponto WHERE id = ?',
      [ajuste],
    );
    expect(a).toMatchObject({ situacao: 'pendente' });
    expect(Number(a?.['solicitante_usuario_id'])).toBe(m.usuario);
    expect(Number(a?.['vinculo_trabalho_id'])).toBe(m.vinculo);
    expect(Number(a?.['estabelecimento_id'])).toBe(m.est);
    expect((await porta.ajustesDaSolicitacao(eu, id)).map((x) => [x.id, x.situacao])).toEqual([
      [ajuste, 'pendente'],
    ]);

    // Quem pediu não aprova o próprio ajuste (regra do ponto): a recusa desfaz a operação inteira.
    expect(
      (
        await erro(
          porta.gravarSgh(eu, trilha(id), async (g) => {
            const x = await g.ponto.ajuste(ajuste);
            await g.ponto.decidirAjuste({
              id: ajuste,
              versao: x!.versao,
              situacao: 'aprovado',
              motivo: null,
              por: m.login,
            });
          }),
        )
      )?.codigo,
    ).toBe('aprovador-e-solicitante');

    await porta.gravarSgh(gestor, trilha(id), async (g) => {
      const x = await g.ponto.ajuste(ajuste);
      expect(x?.situacao).toBe('pendente');
      await g.ponto.decidirAjuste({
        id: ajuste,
        versao: x!.versao,
        situacao: 'aprovado',
        motivo: null,
        por: m.loginGestor,
      });
      const s = await g.solicitacao(id);
      await g.decidirSolicitacao({
        id,
        versao: s!.versao,
        situacao: 'aprovada',
        motivo: null,
        ferias: null,
        por: m.loginGestor,
      });
    });
    const [d] = await ler(
      'SELECT situacao, aprovador_usuario_id, decidido_em IS NOT NULL AS decidido FROM ajuste_ponto WHERE id = ?',
      [ajuste],
    );
    expect(d?.['situacao']).toBe('aprovado');
    expect(Number(d?.['aprovador_usuario_id'])).toBe(m.gestor);
    expect(Number(d?.['decidido'])).toBe(1);
    expect((await porta.solicitacao(gestor, id))?.situacao).toBe('aprovada');
  });

  // A sequência do ServicoAutoatendimento.decidir para o abono e o atestado aprovados, com o gestor na sessão: o ajuste é
  // pedido em nome do colaborador (`por` = quem fez a solicitação) e aprovado pelo gestor na mesma transação.
  for (const [tipo, dia] of [
    ['abono', '2026-10-22'],
    ['atestado', '2026-10-23'],
  ] as const)
    it(`ponto: ${tipo} aprovado pela sequência do decidir grava o ajuste do colaborador aprovado pelo gestor`, async () => {
      const id = await porta.gravarSgh(eu, trilha(), (g) =>
        g.incluirSolicitacao({ ...pedido, tipo, inicio: dia, fim: dia, vinculo: m.vinculo, por: m.login }),
      );
      const x = await porta.solicitacao(gestor, id);
      expect(x?.pedidoPor.toLowerCase()).toBe(m.login);
      const ajuste = await porta.gravarSgh(gestor, trilha(id), async (g) => {
        const atual = await g.solicitacao(id);
        expect(atual?.situacao).toBe('pendente');
        await g.ponto.travarPessoa(m.colaborador);
        expect((await g.ponto.eventosPeriodo(m.vinculo)).filter((y) => y.competencia === '2026-10')).toEqual(
          [],
        );
        expect(await g.ponto.ajustes(m.vinculo, '2026-10-01', '2026-10-31')).toBeInstanceOf(Array);
        const ajuste = await g.ponto.incluirAjuste({
          vinculo: m.vinculo,
          dia,
          tipo: 'justificativa',
          marcacao: null,
          instante: null,
          movimento,
          justificativa,
          periodo: null,
          // O serviço manda null (o dia inteiro); o modelo próprio ainda exige os minutos (aviso ao integrador).
          minutos: 480,
          motivo: `Solicitação ${id} (${tipo}) aprovada`,
          por: x!.pedidoPor,
        });
        await g.ligarAjuste({ ajuste, solicitacao: id });
        const a = await g.ponto.ajuste(ajuste);
        await g.ponto.decidirAjuste({
          id: a!.id,
          versao: a!.versao,
          situacao: 'aprovado',
          motivo: null,
          por: m.loginGestor,
        });
        await g.decidirSolicitacao({
          id,
          versao: atual!.versao,
          situacao: 'aprovada',
          motivo: null,
          ferias: null,
          por: m.loginGestor,
        });
        return ajuste;
      });
      const [d] = await ler(
        'SELECT situacao, solicitante_usuario_id, aprovador_usuario_id, tipo_movimento_ponto_id FROM ajuste_ponto WHERE id = ?',
        [ajuste],
      );
      expect(d?.['situacao']).toBe('aprovado');
      expect(Number(d?.['solicitante_usuario_id'])).toBe(m.usuario);
      expect(Number(d?.['aprovador_usuario_id'])).toBe(m.gestor);
      expect(Number(d?.['tipo_movimento_ponto_id'])).toBe(movimento);
      expect((await porta.solicitacao(gestor, id))?.situacao).toBe('aprovada');
      expect((await porta.ajustesDaSolicitacao(gestor, id)).map((y) => [y.id, y.situacao])).toEqual([
        [ajuste, 'aprovado'],
      ]);
    });

  it('ponto: a recusa do domínio do ponto (justificativa obrigatória) desfaz o pedido inteiro', async () => {
    const antes = await solicitacoes();
    const ajustes = await contar('SELECT COUNT(*) AS q FROM ajuste_ponto WHERE estabelecimento_id = ?', [
      m.est,
    ]);
    const p = await erro(
      porta.gravarSgh(eu, trilha(), async (g) => {
        await g.incluirSolicitacao({ ...pedido, vinculo: m.vinculo, por: m.login });
        await g.ponto.incluirAjuste({
          vinculo: m.vinculo,
          dia: '2026-10-21',
          tipo: 'inclusao',
          marcacao: null,
          instante: '2026-10-21T08:00',
          movimento: null,
          justificativa: null,
          periodo: null,
          minutos: null,
          motivo: 'x',
          por: m.login,
        });
      }),
    );
    expect(p?.codigo).toBe('justificativa-obrigatoria');
    expect(await solicitacoes()).toBe(antes);
    expect(await contar('SELECT COUNT(*) AS q FROM ajuste_ponto WHERE estabelecimento_id = ?', [m.est])).toBe(
      ajustes,
    );
  });

  it('cadastro: o vínculo relido com o CPF cifrado, a correção pela versão e a correção na trilha, na mesma transação', async () => {
    const motivo = `Correção pelo autoatendimento (sintético ${Date.now()})`;
    const versao = await porta.gravarSgh(gestor, trilha(), async (g) => {
      const v = await g.pessoas.vinculo(m.vinculo);
      expect(v?.id).toBe(m.vinculo);
      expect(cifra.decifrar(v!.cpfCifrado)).toMatch(/^\d{11}$/);
      const tipo = v!.tipo === 'estatutario' ? 'estatutario' : 'clt';
      await g.pessoas.corrigirVinculo({
        id: v!.id,
        versao: v!.versao,
        nome: v!.nome,
        matricula: v!.matricula,
        tipo,
        admissao: v!.admissao,
        por: m.loginGestor,
      });
      await g.pessoas.registrarCorrecao({
        vinculo: v!.id,
        operacao: 'alteracao_cadastral',
        antes: { regime: v!.tipo },
        depois: { regime: tipo },
        motivo,
        por: m.loginGestor,
      });
      return v!.versao;
    });
    const [v] = await ler('SELECT versao FROM vinculo_trabalho WHERE id = ?', [m.vinculo]);
    expect(Number(v?.['versao'])).toBe(versao + 1);
    expect(
      await contar(
        "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'vinculo_trabalho' AND entidade_id = ? AND motivo = ? AND usuario_id = ?",
        [m.vinculo, motivo, m.gestor],
      ),
    ).toBe(1);
  });

  it('cadastro: alteração cadastral aprovada pela sequência do decidir (nome novo, histórico de correção e trilha)', async () => {
    const nome = `COLABORADOR SINTETICO L0302 ${Date.now() % 1_000_000}`;
    const porque = `Solicitação sintética do colaborador: nome (${nome})`;
    const versao = await porta.gravarSgh(gestor, trilha(), async (g) => {
      const v = await g.pessoas.vinculo(m.vinculo);
      const antes = { nome: v!.nome };
      const depois = { nome };
      await g.pessoas.corrigirVinculo({
        id: v!.id,
        versao: v!.versao,
        nome,
        matricula: v!.matricula,
        tipo: v!.tipo,
        admissao: v!.admissao,
        por: m.loginGestor,
      });
      await g.pessoas.incluirHistorico({
        vinculo: v!.id,
        tipo: 'correcao',
        vigencia: '2026-10-20',
        antes: `nome: ${antes.nome}`,
        depois: `nome: ${depois.nome}`,
        motivo: porque,
        por: m.loginGestor,
      });
      await g.pessoas.registrarCorrecao({
        vinculo: v!.id,
        operacao: 'colaborador.corrigido',
        antes,
        depois,
        motivo: porque,
        por: m.loginGestor,
      });
      return v!.versao;
    });
    const [c] = await ler('SELECT nome FROM colaborador WHERE id = ?', [m.colaborador]);
    expect(c?.['nome']).toBe(nome);
    const [v] = await ler('SELECT versao FROM vinculo_trabalho WHERE id = ?', [m.vinculo]);
    expect(Number(v?.['versao'])).toBe(versao + 1);
    expect(
      await contar(
        "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'vinculo_trabalho' AND entidade_id = ? AND motivo = ? AND usuario_id = ?",
        [m.vinculo, porque, m.gestor],
      ),
    ).toBe(2);
  });

  it('férias sem o cálculo ligado: o gravador próprio das férias lê na mesma transação (nunca modelo-pendente)', async () => {
    const antes = await solicitacoes();
    let lidas: unknown = null;
    const desfazer = new Error('desfazer o pedido do teste');
    const p = await porta
      .gravarSgh(eu, trilha(), async (g) => {
        await g.incluirSolicitacao({ ...pedido, vinculo: m.vinculo, por: m.login });
        lidas = await g.folha.feriasDoVinculoComTrava(m.vinculo);
        throw desfazer;
      })
      .catch((e: unknown) => e);
    expect(p).toBe(desfazer);
    expect(Array.isArray(lidas)).toBe(true);
    expect(await solicitacoes()).toBe(antes);
  });

  it('sem a chave do CPF: a porta do cadastro sobe e o que lê o CPF diz o que falta (não 503 genérico)', async () => {
    const falta = diagnosticoChaveCpf({}).falta!;
    const semChave = new PortaPessoasPropria(m.nucleo, cifraCpfAusente(falta));
    const p = await erro(semChave.vinculo(gestor, m.vinculo));
    expect(p).toMatchObject({ codigo: 'chave-cpf-ausente', status: 503 });
    expect(p?.detail).toContain('PESSOAS_CHAVE_CPF');
    // O efeito no cadastro com a mesma cifra recusa igual e desfaz o pedido.
    const efeitos = efeitosAutoatendimentoProprios({
      pessoas: semChave,
      ponto: new PortaPontoPropria(m.nucleo, cifraCpfAusente(falta)),
    });
    const antes = await solicitacoes();
    const q = await erro(
      new PortaAutoatendimentoPropria(m.nucleo, efeitos).gravarSgh(eu, trilha(), async (g) => {
        await g.incluirSolicitacao({ ...pedido, vinculo: m.vinculo, por: m.login });
        await g.pessoas.vinculo(m.vinculo);
      }),
    );
    expect(q?.codigo).toBe('chave-cpf-ausente');
    expect(await solicitacoes()).toBe(antes);
  });
});
