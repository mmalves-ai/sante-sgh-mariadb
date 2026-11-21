// Integração da porta própria do retrato da validade do conselho sobre o MariaDB real (cliente f22_o5; lote F2.2 05-16).
// Leitura: a validade conferida (validade_conselho) vale sobre a da inscrição pela regra única (último evento por
// ocorrido em e id; exclusão derruba; registro suspenso não conta); a inscrição cancelada não conta como ativa. Gravação: sem a tabela do retrato no modelo (DDL pedido), gravarRetrato devolve false e nada finge gravar; com
// a tabela, a linha do dia fica gravada. Massa sintética (profissional fictício 9905160, CPF sintético) com as chaves
// estrangeiras desligadas só na montagem; apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  inserirSintetico,
  SEM_BANCO,
} from './importadores/integracao.spec-util.js';
import { PortaConselhoPropria } from './pessoas-conselho-propria.js';
import { retratoDoCliente } from './pessoas-conselho.service.js';

const PROF = 9_905_160;
const CPF = '99905160001';

describe.skipIf(SEM_BANCO)('retrato da validade do conselho sobre o banco próprio (f22_o5)', () => {
  let nucleo: NucleoProprio;
  const ins: number[] = [];

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      await e.executar(
        'DELETE v FROM validade_conselho v JOIN inscricao_conselho i ON i.id = v.inscricao_conselho_id WHERE i.profissional_id = ?',
        [PROF],
      );
      await e.executar('DELETE FROM inscricao_conselho WHERE profissional_id = ?', [PROF]);
      await e.executar('DELETE FROM colaborador WHERE cpf = ? OR profissional_id = ?', [CPF, PROF]);
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    await escrever(nucleo, (e) => garantirEstabelecimento(e, 'fo516c'));
    await limpar();
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const agora = new Date();
      const colab = await inserirSintetico(e, 'colaborador', {
        profissional_id: PROF,
        nome: 'Colaborador sintético 05-16',
        cpf: CPF,
        data_nascimento: '1990-01-01',
        grau_instrucao: '07',
        raca_cor: 'nao_informada',
        ativo: 1,
        criado_em: agora,
      });
      const inscricao = (sequencia: number, situacao: string, validade: string | null) =>
        inserirSintetico(e, 'inscricao_conselho', {
          profissional_id: PROF,
          sequencia,
          conselho_classe_id: 9_905_160,
          unidade_federativa_id: 9_905_160,
          numero_inscricao: `F516${sequencia}`,
          situacao,
          validade,
          criado_em: agora,
        });
      ins.push(await inscricao(1, 'ativa', '2020-01-01'));
      ins.push(await inscricao(2, 'ativa', null));
      ins.push(await inscricao(3, 'cancelada', '2099-12-31'));
      ins.push(await inscricao(4, 'ativa', '2021-01-01'));
      ins.push(await inscricao(5, 'ativa', '2022-01-01'));
      ins.push(await inscricao(6, 'ativa', '2023-01-01'));
      const conf = (inscricao: number, ocorrido: Date, operacao: string, validade: string | null, situacao = 'ativo') =>
        inserirSintetico(e, 'validade_conselho', {
          inscricao_conselho_id: inscricao,
          colaborador_id: colab,
          operacao,
          data_validade: validade,
          situacao_registro: situacao,
          ocorrido_em: ocorrido,
          criado_em: agora,
        });
      const antes = new Date(agora.getTime() - 86_400_000 * 30);
      await conf(ins[1]!, agora, 'inclusao', '2099-12-31');
      // Conferência excluída por último: volta a validade da inscrição.
      await conf(ins[3]!, antes, 'inclusao', '2098-01-01');
      await conf(ins[3]!, agora, 'exclusao', '2098-01-01');
      // Retroativa lançada depois (id maior, ocorrido antes): não passa à frente.
      await conf(ins[4]!, agora, 'alteracao', '2097-01-01');
      await conf(ins[4]!, antes, 'inclusao', '2000-01-01');
      // Registro suspenso: sai da conta.
      await conf(ins[5]!, agora, 'alteracao', '2096-01-01', 'suspenso');
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await limpar();
    await nucleo.encerrar();
  });

  it('lê as inscrições dos colaboradores ativos com a validade conferida', async () => {
    const porta = new PortaConselhoPropria(nucleo, CLIENTE);
    const meus = (await porta.registrosAtivos()).filter((r) => r.profissional === PROF);
    expect(meus).toEqual([
      { registro: ins[0], profissional: PROF, ativo: true, validade: '2020-01-01' },
      { registro: ins[1], profissional: PROF, ativo: true, validade: '2099-12-31' },
      { registro: ins[2], profissional: PROF, ativo: false, validade: '2099-12-31' },
      { registro: ins[3], profissional: PROF, ativo: true, validade: '2021-01-01' },
      { registro: ins[4], profissional: PROF, ativo: true, validade: '2097-01-01' },
      { registro: ins[5], profissional: PROF, ativo: false, validade: '2096-01-01' },
    ]);
  });

  it('grava o retrato do dia em retrato_validade_conselho (DDL 15_RH/06) e refaz a linha no mesmo dia', async () => {
    const porta = new PortaConselhoPropria(nucleo, CLIENTE);
    const r = await retratoDoCliente(porta, CLIENTE, new Date());
    expect(r.registros).toBeGreaterThanOrEqual(2);
    expect(r.gravado).toBe(true);
    const l = await escrever(nucleo, (e) =>
      e.uma('SELECT registros, janela_dias FROM retrato_validade_conselho WHERE dia = ?', [r.dia]),
    );
    expect(l).toMatchObject({ registros: r.registros, janela_dias: r.janelaDias });
    const deNovo = await retratoDoCliente(porta, CLIENTE, new Date());
    expect(deNovo.gravado).toBe(true);
    const n = await escrever(nucleo, (e) =>
      e.uma('SELECT COUNT(*) AS n FROM retrato_validade_conselho WHERE dia = ?', [r.dia]),
    );
    expect(Number(n!['n'])).toBe(1);
  });
});
