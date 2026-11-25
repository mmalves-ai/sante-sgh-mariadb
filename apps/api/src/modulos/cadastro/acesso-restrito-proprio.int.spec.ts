// Contrato de efeito do paciente com acesso restrito (F8, 02-CAD linha 10) contra o MariaDB real, no cliente de teste
// f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real). Prova o que fica no banco: a marca
// em `paciente_acesso_restrito` (tipo, motivo, abrangência, exibição, quem marcou; a repetida e o pseudônimo ausente
// recusados), a liberação nominal em `liberacao_acesso_restrito` (profissional, justificativa, autorizador; o destino
// duplo recusado), a revogação (fim gravado, linha mantida), o encerramento da marca (situação e fim, linha mantida) e
// a decisão de acesso que o filtro das rotas clínicas usa: sem liberação, quebra de vidro; liberado, entra; revogado,
// volta à quebra de vidro; quebra de vidro vigente, entra; marca encerrada, livre. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AcessoRestritoProprio, type EntradaMarcaTela } from './acesso-restrito-proprio.js';
import {
  CEP_TESTE,
  CLIENTE_F22,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { PortaCadastroPropria } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

const COR = 'f8-02-10-restrito';
const CPF = cpfSintetico('990810111');

describe.skipIf(SEM_BANCO)('paciente com acesso restrito no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let s: AcessoRestritoProprio;
  let m: Massa | null = null;
  let paciente = 0;
  let marca = 0;
  let liberacao = 0;
  let profissional = 0;
  let vinculoCriado = 0;
  let emergencia = 0;
  let hospital = '';

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => l.uma<T>(sql, p));
  const t = (entidade: string): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.acessoRestrito', paciente },
    correlacao: COR,
  });
  const c = () => contextoPorta(m!, COR);
  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'gravou';
    } catch (e) {
      return (e as { problema?: { codigo?: string } }).problema?.codigo ?? String(e);
    }
  };
  const entrada = (p: Partial<EntradaMarcaTela> = {}): EntradaMarcaTela => ({
    paciente,
    todosEstabelecimentos: false,
    tipo: 'confidencial',
    motivo: 'Pedido formal do paciente (sintético)',
    exibicao: 'iniciais',
    pseudonimo: null,
    exigeQuebraVidro: true,
    inicio: '2026-01-01T00:00',
    fim: null,
    ...p,
  });
  const decidir = (plataforma = false) =>
    s.decidir({ hospital, login: m!.login, paciente, plataforma }).then((d) => d.desfecho);

  async function limparMinhas(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      const ms = 'SELECT id FROM paciente_acesso_restrito WHERE paciente_id = ?';
      await e.executar(
        `DELETE FROM liberacao_acesso_restrito WHERE paciente_acesso_restrito_id IN (SELECT id FROM (${ms}) x)`,
        [paciente],
      );
      await e.executar('DELETE FROM paciente_acesso_restrito WHERE paciente_id = ?', [paciente]);
      await e.executar('DELETE FROM acesso_emergencial WHERE paciente_id = ? AND justificativa LIKE ?', [
        paciente,
        `${MARCA}%`,
      ]);
      if (vinculoCriado) await e.executar('DELETE FROM usuario_profissional WHERE id = ?', [vinculoCriado]);
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    s = new AcessoRestritoProprio(nucleo, CLIENTE_F22, undefined, () => '2026-06-15T10:00:00');
    const est = await um<{ codigo: unknown }>('SELECT codigo FROM estabelecimento WHERE id = ?', [
      m.estabelecimento,
    ]);
    hospital = String(est!.codigo);
    const cadastro = new PortaCadastroPropria(nucleo, CLIENTE_F22);
    const existente = await um<{ id: unknown }>(
      'SELECT p.id FROM paciente p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE f.cpf = ? AND p.excluido_em IS NULL',
      [CPF],
    );
    paciente = existente
      ? Number(existente.id)
      : (
          await cadastro.cadastrar(
            contextoPorta(m),
            {
              nome: `PACIENTE RESTRITO ${MARCA}`,
              nascimento: '1970-03-10',
              sexo: 'M',
              cpf: CPF,
              nomeMae: `MAE ${MARCA}`,
              naturalidade: 'BELO HORIZONTE',
              ufNaturalidade: 'MG',
              cep: CEP_TESTE,
              numero: 110,
              celular: '31999991011',
              contatoNome: `CONTATO ${MARCA}`,
              contatoTelefone: '3133331011',
            },
            contextoGravacao(m),
          )
        ).resultado.idPaciente;
    await limparMinhas();
    // A conta da massa representa um profissional (o que já tiver, ou o da massa, criado aqui e apagado no fim).
    const vig = await um<{ profissional_id: unknown }>(
      'SELECT profissional_id FROM usuario_profissional WHERE usuario_vigente_id = ?',
      [m.usuario],
    );
    if (vig) profissional = Number(vig.profissional_id);
    else {
      profissional = m.profissional;
      vinculoCriado = await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
        e.inserir(
          'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, NOW(3))',
          [m!.usuario, m!.profissional, '2026-01-01'],
        ),
      );
    }
  }, 120_000);

  afterAll(async () => {
    if (m && paciente) await limparMinhas();
    await nucleo?.encerrar?.();
  });

  it('sem marca, o acesso é livre', async () => {
    expect(await decidir()).toBe('livre');
  });

  it('marca o paciente: grava a marca com quem marcou; repetida e pseudônimo ausente recusados', async () => {
    marca = await s.marcar(c(), entrada(), t('paciente_acesso_restrito'));
    expect(
      await um(
        `SELECT tipo_marca, estabelecimento_id, exibicao_nome, situacao, exige_quebra_vidro AS q, solicitante_usuario_id AS u,
                origem, versao FROM paciente_acesso_restrito WHERE id = ?`,
        [marca],
      ),
    ).toMatchObject({
      tipo_marca: 'confidencial',
      estabelecimento_id: m!.estabelecimento,
      exibicao_nome: 'iniciais',
      situacao: 'ativa',
      q: 1,
      u: m!.usuario,
      origem: 'sistema',
      versao: 1,
    });
    expect(await codigo(s.marcar(c(), entrada(), t('paciente_acesso_restrito')))).toBe('marca-repetida');
    expect(
      await codigo(
        s.marcar(c(), entrada({ tipo: 'vip', exibicao: 'pseudonimo' }), t('paciente_acesso_restrito')),
      ),
    ).toBe('pseudonimo-ausente');
    const v = await s.visao(c(), paciente);
    expect(v.marcas).toHaveLength(1);
    expect(v.marcas[0]).toMatchObject({ id: marca, viva: true, liberacoes: [] });
    expect((await s.pacientes(c())).some((x) => x.paciente === paciente)).toBe(true);
  });

  it('marca viva sem liberação: o profissional da conta cai na quebra de vidro; a plataforma entra', async () => {
    expect(await decidir()).toBe('quebra-de-vidro');
    expect(await decidir(true)).toBe('liberado');
  });

  it('libera o profissional nominalmente (com autorizador) e recusa o destino duplo', async () => {
    expect(
      await codigo(
        s.liberar(
          c(),
          {
            marca,
            profissionalId: profissional,
            equipeId: 1,
            justificativa: 'Assistente do caso',
            inicio: '2026-01-01',
            fim: null,
          },
          t('liberacao_acesso_restrito'),
        ),
      ),
    ).toBe('destino-unico');
    liberacao = await s.liberar(
      c(),
      {
        marca,
        profissionalId: profissional,
        equipeId: null,
        justificativa: 'Médico assistente do caso (sintético)',
        inicio: '2026-01-01',
        fim: null,
      },
      t('liberacao_acesso_restrito'),
    );
    expect(
      await um(
        `SELECT paciente_acesso_restrito_id AS m, profissional_id AS p, equipe_profissional_id AS e, autorizador_usuario_id AS a,
                vigencia_fim AS fim FROM liberacao_acesso_restrito WHERE id = ?`,
        [liberacao],
      ),
    ).toMatchObject({ m: marca, p: profissional, e: null, a: m!.usuario, fim: null });
    expect(await decidir()).toBe('liberado');
  });

  it('revoga a liberação: o fim fica gravado, a linha fica, e o acesso volta à quebra de vidro', async () => {
    const v = (await s.visao(c(), paciente)).marcas[0]!.liberacoes[0]!;
    await s.revogar(c(), { id: liberacao, versao: v.versao }, t('liberacao_acesso_restrito'));
    const l = await um<{ fim: unknown; versao: unknown }>(
      'SELECT vigencia_fim AS fim, versao FROM liberacao_acesso_restrito WHERE id = ?',
      [liberacao],
    );
    expect(l!.fim).not.toBeNull();
    expect(Number(l!.versao)).toBe(v.versao + 1);
    expect(
      await codigo(s.revogar(c(), { id: liberacao, versao: v.versao + 1 }, t('liberacao_acesso_restrito'))),
    ).toBe('ja-revogada');
    // A decisão usa a hora real do banco para a quebra de vidro e a hora fixa do teste para as vigências.
    expect(await decidir()).toBe('quebra-de-vidro');
  });

  it('quebra de vidro vigente do usuário abre o paciente marcado', async () => {
    const mot = await um<{ id: unknown }>(
      'SELECT id FROM motivo_acesso_emergencial WHERE ativo ORDER BY id LIMIT 1',
      [],
    );
    if (!mot) return;
    emergencia = await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
      e.inserir(
        `INSERT INTO acesso_emergencial (estabelecimento_id, usuario_id, paciente_id, motivo_acesso_emergencial_id, justificativa,
           inicio_em, fim_em, situacao, criado_em) VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3) + INTERVAL 30 MINUTE, 'ativo', NOW(3))`,
        [m!.estabelecimento, m!.usuario, paciente, Number(mot.id), `${MARCA} emergência sintética`],
      ),
    );
    expect(emergencia).toBeGreaterThan(0);
    expect(await decidir()).toBe('emergencia');
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
      e.executar("UPDATE acesso_emergencial SET situacao = 'encerrado', encerrado_em = NOW(3) WHERE id = ?", [
        emergencia,
      ]),
    );
  });

  it('encerra a marca com motivo: situação e fim gravados, linha mantida, acesso livre', async () => {
    const v = (await s.visao(c(), paciente)).marcas[0]!;
    expect(await codigo(s.encerrar(c(), { id: marca, versao: v.versao, motivo: 'curto' }, t('x')))).toBe(
      'motivo-curto',
    );
    await s.encerrar(
      c(),
      { id: marca, versao: v.versao, motivo: 'Pedido do paciente revogado' },
      t('paciente_acesso_restrito'),
    );
    expect(
      await um(
        'SELECT situacao, vigencia_fim IS NOT NULL AS fim, versao, excluido_em FROM paciente_acesso_restrito WHERE id = ?',
        [marca],
      ),
    ).toMatchObject({ situacao: 'encerrada', fim: 1, versao: v.versao + 1, excluido_em: null });
    expect(await decidir()).toBe('livre');
    expect(
      await codigo(
        s.liberar(
          c(),
          {
            marca,
            profissionalId: profissional,
            equipeId: null,
            justificativa: 'Depois do encerramento',
            inicio: '2026-07-01',
            fim: null,
          },
          t('liberacao_acesso_restrito'),
        ),
      ),
    ).toBe('marca-encerrada');
  });
});
