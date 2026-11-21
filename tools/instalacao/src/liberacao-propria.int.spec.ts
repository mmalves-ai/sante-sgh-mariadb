// Integração da regra 1 da farmácia (M41) no `liberacao:ligar-tudo`, contra o MariaDB real (cliente f22_o5; massa
// sintética no estabelecimento fo513l, setores F513A/F513B; nenhuma pessoa real; chaves estrangeiras desligadas só na
// montagem da massa). Os dois sentidos: sem a prescrição eletrônica em uso numa unidade atendida (pela dispensação ou
// pelo roteamento do local), a chave da dispensação não liga e o motivo cita a unidade; com a prescrição gravada aqui
// e liberada na janela em todas as unidades, liga. A chave fora da regra 1 não lê nada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { conferirNome, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inicioMesAnterior, PortaLiberacaoPropria } from './liberacao-propria.ts';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const H = 'fo513l';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const raiz = resolve(import.meta.dirname, '../../..');

describe.skipIf(SEM_BANCO)('regra 1 da farmácia no ligar-tudo, sobre o banco próprio (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est = 0;
  const id = { local: 0, setorA: 0, setorB: 0 };
  let numero = 0;
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f22-0513-farmacia' }, fn);
  const inserir = (e: Escritor, tabela: string, v: Record<string, unknown>) => {
    const cols = Object.keys(v).map(conferirNome);
    return e.inserir(
      `INSERT INTO ${conferirNome(tabela)} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      Object.values(v),
    );
  };
  const comChavesDesligadas = (fn: (e: Escritor) => Promise<void>) =>
    escrever(async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        await fn(e);
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
  const limpar = () =>
    comChavesDesligadas(async (e) => {
      for (const t of ['dispensacao', 'prescricao', 'liberacao_chave'])
        await e.executar(`DELETE FROM ${conferirNome(t)} WHERE estabelecimento_id = ?`, [est]);
      await e.executar(
        'DELETE ls FROM local_estoque_setor ls JOIN local_estoque l ON l.id = ls.local_estoque_id WHERE l.estabelecimento_id = ?',
        [est],
      );
      await e.executar('DELETE FROM local_estoque WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM setor_funcional WHERE estabelecimento_id = ?', [est]);
    });
  const setor = (e: Escritor, codigo: string) =>
    inserir(e, 'setor_funcional', {
      estabelecimento_id: est,
      codigo,
      nome: `SETOR SINTETICO ${codigo}`,
      tipo: 'assistencial',
      criado_em: new Date(),
    });
  const dispensar = (e: Escritor, setorId: number, quando: Date) =>
    inserir(e, 'dispensacao', {
      estabelecimento_id: est,
      numero: ++numero,
      tipo: 'horario',
      prescricao_id: 990513,
      atendimento_id: 990513,
      paciente_id: 990513,
      local_estoque_id: id.local,
      setor_funcional_id: setorId,
      centro_custo_id: 990513,
      dispensado_em: quando,
      dispensado_usuario_id: 990513,
      criado_em: quando,
    });
  const prescrever = (e: Escritor, setorId: number, liberada: Date, origem = 'sistema') =>
    inserir(e, 'prescricao', {
      estabelecimento_id: est,
      numero: ++numero,
      paciente_id: 990513,
      atendimento_id: 990513,
      setor_funcional_id: setorId,
      prescritor_profissional_id: 990513,
      situacao: 'vigente',
      prescrito_em: liberada,
      vigencia_inicio_em: liberada,
      vigencia_fim_em: new Date(liberada.getTime() + 86_400_000),
      liberada_em: liberada,
      origem,
      criado_em: liberada,
    });
  const porta = () => new PortaLiberacaoPropria(nucleo, CLIENTE, 'teste-f22-0513-farmacia');
  const motivo = () => porta().regraFarmacia(H, 'recurso', 'suprimentos.dispensacao');

  beforeAll(async () => {
    const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], {
      cwd: raiz,
      encoding: 'utf8',
    });
    if (!new RegExp(`\\b${CLIENTE}\\b`).test(lista))
      execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 5'], {
        cwd: raiz,
      });
    nucleo = new NucleoProprio();
    est = await escrever(async (e) => {
      const r = await e.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ?', [H]);
      if (r) return Number(r.id);
      return e.inserir(
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [H, 'Teste F2.2 lote 05-13', 'Teste F2.2 lote 05-13', new Date()],
      );
    });
    await limpar();
    await comChavesDesligadas(async (e) => {
      id.setorA = await setor(e, 'F513A');
      id.setorB = await setor(e, 'F513B');
      id.local = await inserir(e, 'local_estoque', {
        estabelecimento_id: est,
        codigo: 'F513L',
        nome: 'FARMACIA SINTETICA',
        tipo: 'farmacia_central',
        criado_em: new Date(),
      });
      await dispensar(e, id.setorA, new Date());
    });
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('a janela das unidades atendidas começa no primeiro dia do mês anterior', () => {
    expect(inicioMesAnterior(new Date(2026, 0, 15))).toEqual(new Date(2025, 11, 1));
  });

  it('chave fora da regra 1: nada a conferir', async () => {
    expect(await porta().regraFarmacia(H, 'operacao', 'cadastro.paciente')).toBeNull();
  });

  it('sem a prescrição eletrônica ligada e em uso: não liga', async () => {
    expect(await motivo()).toMatch(/prescrição eletrônica/);
  });

  it('liga só quando todas as unidades atendidas (dispensação e roteamento) têm a prescrição em uso', async () => {
    const agora = new Date();
    await comChavesDesligadas(async (e) => {
      await inserir(e, 'liberacao_chave', {
        estabelecimento_id: est,
        tipo: 'recurso',
        chave: 'pep.prescricao.cpoe',
        escopo: 'hospital',
        valor: '*',
        ligada: true,
        criado_em: agora,
      });
      await prescrever(e, id.setorA, agora);
      // A prescrição migrada ou velha não prova o uso.
      await prescrever(e, id.setorB, agora, 'migracao');
      await prescrever(e, id.setorB, new Date(agora.getTime() - 30 * 86_400_000));
    });
    expect(await motivo()).toBeNull();
    // O setor B passa a ser atendido pelo local (roteamento): sem a prescrição em uso lá, não liga.
    await comChavesDesligadas(async (e) => {
      await inserir(e, 'local_estoque_setor', {
        local_estoque_id: id.local,
        setor_funcional_id: id.setorB,
        criado_em: agora,
      });
    });
    expect(await motivo()).toContain('F513B');
    await comChavesDesligadas(async (e) => {
      await prescrever(e, id.setorB, agora);
    });
    expect(await motivo()).toBeNull();
  });
});
