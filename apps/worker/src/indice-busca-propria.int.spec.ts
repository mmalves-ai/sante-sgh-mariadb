// Integração da porta própria do índice de busca e da fila de duplicidades sobre o MariaDB real (cliente f22_o5; lote
// F2.2 05-15): os cadastros mudados depois da marca aparecem; o índice é gravado (versão 1, trilha) e regravado sem
// repetir palavra; o par parecido vai uma vez à fila (critério fonético, situação aberto); o excluído sai do índice; a
// contagem e o reparo respondem. Massa sintética (pessoas fictícias, sem CPF) com as chaves estrangeiras desligadas só
// na montagem; apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
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
import { PortaIndiceBuscaPropria } from './indice-busca-propria.js';
import { avaliarPar } from './indice-busca.service.js';

describe.skipIf(SEM_BANCO)('índice de busca e fila de duplicidades sobre o banco próprio (f22_o5)', () => {
  let nucleo: NucleoProprio;
  const pacientes: number[] = [];
  const pessoas: number[] = [];
  let antes = '';
  let celular = 0;

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      const ps = (
        await e.consultar(
          'SELECT id, pessoa_fisica_id FROM paciente WHERE numero_prontuario IN (9905150001, 9905150002)',
        )
      ).map((r) => [Number(r['id']), Number(r['pessoa_fisica_id'])] as const);
      for (const [p, pf] of ps) {
        await e.executar(
          'DELETE FROM suspeita_duplicidade WHERE primeiro_paciente_id = ? OR segundo_paciente_id = ?',
          [p, p],
        );
        await e.executar("DELETE FROM chave_busca_nome WHERE entidade = 'paciente' AND registro_id = ?", [p]);
        await e.executar('DELETE FROM telefone_pessoa WHERE pessoa_fisica_id = ?', [pf]);
        await e.executar('DELETE FROM paciente WHERE id = ?', [p]);
        await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [pf]);
      }
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f515i'));
    await limpar();
    antes = new Date(Date.now() - 1000).toISOString();
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const agora = new Date();
      const tipo = await e.uma("SELECT id FROM tipo_telefone WHERE codigo = 'celular'", []);
      celular = tipo
        ? Number(tipo['id'])
        : await inserirSintetico(e, 'tipo_telefone', {
            codigo: 'celular',
            descricao: 'Celular',
            criado_em: agora,
          });
      for (const [i, prontuario] of [9_905_150_001, 9_905_150_002].entries()) {
        const pf = await inserirSintetico(e, 'pessoa_fisica', {
          nome: i === 0 ? 'ANA MARIA SINTETICA QUINZE' : 'ANA MARYA SINTETICA QUINZE',
          data_nascimento: '1980-01-01',
          nome_mae: 'JOANA SINTETICA',
          criado_em: agora,
        });
        pessoas.push(pf);
        // O mesmo celular nos dois cadastros: o critério telefone entra no escore (a mesma regra da API).
        await inserirSintetico(e, 'telefone_pessoa', {
          pessoa_fisica_id: pf,
          sequencia: 1,
          tipo_telefone_id: celular,
          ddi: '55',
          ddd: '11',
          numero: '999990515',
          origem: 'sistema',
          criado_em: agora,
        });
        pacientes.push(
          await inserirSintetico(e, 'paciente', {
            pessoa_fisica_id: pf,
            numero_prontuario: prontuario,
            criado_em: agora,
          }),
        );
      }
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await limpar();
    await nucleo.encerrar();
  });

  it('os mudados depois da marca aparecem; o índice é gravado e regravado sem repetir palavra', async () => {
    const porta = new PortaIndiceBuscaPropria(nucleo, CLIENTE);
    const mudados = await porta.mudados('paciente', { em: antes, id: 0 }, 2000);
    expect(mudados.map((x) => x.id)).toEqual(expect.arrayContaining(pacientes));
    const cadastros = await porta.lerCadastros('paciente', pacientes);
    expect(await porta.indexar('paciente', cadastros)).toBeGreaterThan(0);
    await porta.indexar('paciente', cadastros);
    const r = await escrever(nucleo, (e) =>
      e.uma(
        "SELECT COUNT(*) AS n, COUNT(DISTINCT palavra) AS d, MAX(versao) AS v FROM chave_busca_nome WHERE entidade = 'paciente' AND registro_id = ? AND campo = 'nome'",
        [pacientes[0]],
      ),
    );
    expect(Number(r!['n'])).toBe(Number(r!['d']));
    expect(Number(r!['v'])).toBe(1);
    const c = await porta.contagem('paciente');
    expect(c.indice).toBeGreaterThanOrEqual(2);
    expect(c.cadastro).toBeGreaterThanOrEqual(2);
  });

  it('o par parecido vai uma vez à fila (critérios fonético e telefone, aberto); o excluído sai do índice', async () => {
    const porta = new PortaIndiceBuscaPropria(nucleo, CLIENTE);
    expect(await porta.alimentarFila([pacientes[0]!], avaliarPar)).toBe(1);
    expect(await porta.alimentarFila([pacientes[0]!, pacientes[1]!], avaliarPar)).toBe(0);
    const [a, b] = [...pacientes].sort((x, y) => x - y);
    const s = await escrever(nucleo, (e) =>
      e.uma(
        'SELECT situacao, criterio_fonetica, criterio_telefone, versao FROM suspeita_duplicidade WHERE primeiro_paciente_id = ? AND segundo_paciente_id = ?',
        [a, b],
      ),
    );
    expect(s).toMatchObject({ situacao: 'aberto', versao: 1 });
    expect(Boolean(Number(s!['criterio_fonetica']))).toBe(true);
    expect(Boolean(Number(s!['criterio_telefone']))).toBe(true);
    await escrever(nucleo, (e) =>
      e.executar('UPDATE paciente SET excluido_em = ? WHERE id = ?', [new Date(), pacientes[1]]),
    );
    await porta.indexar('paciente', await porta.lerCadastros('paciente', [pacientes[1]!]));
    const n = await escrever(nucleo, (e) =>
      e.uma("SELECT COUNT(*) AS n FROM chave_busca_nome WHERE entidade = 'paciente' AND registro_id = ?", [
        pacientes[1],
      ]),
    );
    expect(Number(n!['n'])).toBe(0);
    expect(await porta.reparar('solicitante', 10)).toBeGreaterThanOrEqual(0);
  });
});
