// Solicitante externo migrado sem a UF do conselho (recusas da carga, fase 2) contra o MariaDB real, no cliente de
// teste f22_o1, com massa SINTÉTICA (prefixo F22L0102 SUF; nenhuma pessoa real). Prova que o cadastro migrado
// (origem 'migracao', sem UF) aparece na lista e na ficha, sem "null" no registro, e que alterá-lo sem informar a UF é
// recusado: o cadastro novo continua exigindo a UF. SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CadastroLigacoesProprio } from './cadastro-ligacoes-proprio.js';
import {
  CLIENTE_F22,
  contextoPorta,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { PortaCadastroPropria } from './porta-propria.js';
import { lerUnificacaoDoSolicitante } from './solicitante-unificacao-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

const COR = 'recusas-fase2-solicitante-sem-uf';
const NOME = `ANA ${MARCA} SUF SINTETICA`;

describe.skipIf(SEM_BANCO)('solicitante externo migrado sem UF do conselho (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let m: Massa | null = null;
  let id = 0;
  let outro = 0;

  const limpar = () =>
    nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      await e.executar(
        'UPDATE solicitante_externo SET sucessor_solicitante_externo_id = NULL, unificado_em = NULL WHERE nome LIKE ?',
        [`%${MARCA} SUF%`],
      );
      await e.executar('DELETE FROM solicitante_externo WHERE nome LIKE ?', [`%${MARCA} SUF%`]);
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      id = await e.inserir(
        `INSERT INTO solicitante_externo (nome, conselho_classe_id, numero_conselho, conselho_unidade_federativa_id,
           data_inscricao, ativo, origem, criado_em) VALUES (?, ?, '9916001', NULL, '2026-01-01', TRUE, 'migracao', NOW(3))`,
        [NOME, m!.conselho],
      );
      // Um cadastro unificado no migrado: a ficha do outro mostra o registro do migrado.
      outro = await e.inserir(
        `INSERT INTO solicitante_externo (nome, conselho_classe_id, numero_conselho, conselho_unidade_federativa_id,
           data_inscricao, ativo, sucessor_solicitante_externo_id, unificado_em, criado_em)
         VALUES (?, ?, '9916002', ?, '2026-01-01', FALSE, ?, NOW(3), NOW(3))`,
        [`${NOME} DUPLICADA`, m!.conselho, m!.uf, id],
      );
    });
  });

  afterAll(async () => {
    await limpar();
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  it('o banco recusa o cadastro do sistema sem UF (só o migrado pode faltar)', async () => {
    await expect(
      nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
        e.inserir(
          `INSERT INTO solicitante_externo (nome, conselho_classe_id, numero_conselho, conselho_unidade_federativa_id,
             data_inscricao, ativo, criado_em) VALUES (?, ?, '9916003', NULL, '2026-01-01', TRUE, NOW(3))`,
          [`${NOME} NOVA`, m!.conselho],
        ),
      ),
    ).rejects.toThrow();
  });

  it('aparece na lista do cadastro com a UF nula, e na ficha com o campo vazio para informar', async () => {
    const lista = await new PortaCadastroPropria(nucleo, CLIENTE_F22).listarSolicitantes(
      contextoPorta(m!, COR),
      [id],
    );
    expect(lista.itens.map((x) => ({ id: x.id, uf: x.uf }))).toEqual([{ id, uf: null }]);
    const ficha = await new CadastroLigacoesProprio(nucleo, CLIENTE_F22).fichaSolicitante(
      contextoPorta(m!, COR),
      id,
    );
    expect(ficha.uf).toBe('');
    expect(ficha.numero).toBe('9916001');
  });

  it('o registro do migrado na unificação diz que a UF não veio da origem, nunca "null"', async () => {
    const u = await nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) =>
      lerUnificacaoDoSolicitante(l, outro),
    );
    expect(u.unificadoEm?.registro).toMatch(/9916001 \(UF não informada na origem\)$/);
    expect(u.unificadoEm?.registro).not.toMatch(/null/);
  });

  it('o migrado sem UF não troca de registro com o unificado nele: recusa clara, o duplicado fica intacto', async () => {
    const s = new CadastroLigacoesProprio(nucleo, CLIENTE_F22);
    const c = contextoPorta(m!, COR);
    const ler = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => l.uma<T>(sql, p));
    const sigla = String(
      (await ler<{ s: unknown }>('SELECT sigla AS s FROM unidade_federativa WHERE id = ?', [m!.uf]))!.s,
    );
    const f = await s.fichaSolicitante(c, id);
    const t: RegistroTrilhaTela = {
      estabelecimento: m!.estabelecimento,
      usuario: m!.usuario,
      acao: 'operacao',
      entidade: 'solicitante_externo',
      entidadeId: null,
      dadosDepois: { evento: 'teste', recurso: 'cadastro.ligacoes' },
      correlacao: COR,
    };
    await expect(
      s.alterarSolicitante(
        c,
        {
          id,
          versao: f.versao,
          nome: f.nome,
          conselho: f.conselho,
          uf: sigla,
          numero: '9916002',
          cpf: f.cpf,
          cns: f.cns,
          ocupacao: f.ocupacao,
          especialidade: f.especialidade,
          instituicaoNome: f.instituicaoNome,
          instituicaoCnpj: f.instituicaoCnpj,
          instituicaoCnes: f.instituicaoCnes,
          telefone: f.telefone,
          email: f.email,
          observacao: f.observacao,
        },
        t,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'troca-sem-uf-anterior' } });
    const d = await ler<{ uf: unknown; n: unknown }>(
      'SELECT conselho_unidade_federativa_id AS uf, numero_conselho AS n FROM solicitante_externo WHERE id = ?',
      [outro],
    );
    expect({ uf: Number(d?.uf), n: String(d?.n) }).toEqual({ uf: m!.uf, n: '9916002' });
  });
});
