// M56 regra 8 contra o MariaDB real (cliente f22_o2): o beneficiário que também é paciente do hospital tem os dois
// cadastros separados. A operadora guarda só o id do paciente (paciente_id do beneficiário); a inclusão só confere a
// existência pela chave; a ficha do beneficiário não traz dado clínico; o id inexistente é recusado; nenhuma linha do
// paciente muda. Massa SINTÉTICA, apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import type { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDe,
  criarNucleo,
  limparMassa,
  type MassaBase,
  montarCarteira,
  PODE,
  prepararBase,
  servicoNoBanco,
  sessao,
} from './copia.spec-util.js';

describe.skipIf(!PODE)('M56 regra 8: beneficiário e paciente separados (MariaDB, f22_o2)', () => {
  let nucleo: NucleoProprio;
  let m: MassaBase;
  let paciente = 0;
  let pessoa = 0;

  beforeAll(async () => {
    nucleo = criarNucleo();
    m = await prepararBase(nucleo);
    await limparMassa(nucleo, m);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-10' }, async (e) => {
      const agora = new Date();
      pessoa = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        'PACIENTE SINTETICO L0210',
        agora,
      ]);
      paciente = await e.inserir(
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, cadastro_estabelecimento_id, criado_em) VALUES (?, ?, ?, ?)',
        [pessoa, 902_100_000 + (Date.now() % 100_000), m.est, agora],
      );
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    if (m) await limparMassa(nucleo, m);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-10' }, async (e) => {
      await e.executar('DELETE FROM paciente WHERE id = ?', [paciente]);
      await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [pessoa]);
    });
    await nucleo.encerrar();
  });

  it('só o id do paciente na operadora; nada do cadastro do paciente muda; id inexistente recusado', async () => {
    const versaoPaciente = () =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-10' }, (l) =>
        l.uma<{ versao: unknown }>('SELECT versao FROM paciente WHERE id = ?', [paciente]),
      );
    const antes = await versaoPaciente();
    const { servico, porta } = servicoNoBanco(nucleo);
    const s = sessao(m);
    const k = await montarCarteira(servico, s, {
      registro: '902103',
      base: '90210',
      pacienteHospital: paciente,
    });
    const ficha = await servico.ficha(s, k.titular.id);
    const lido = await porta.beneficiario(s.porta, k.titular.id);
    expect(lido?.pacienteHospital).toBe(paciente);
    expect(ficha.pacienteHospital).toBe(paciente);
    expect(JSON.stringify(ficha)).not.toMatch(/alergia|diagnostico|prontuario|cid/i);
    const ligado = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-10' }, (l) =>
      l.uma<{ paciente_id: unknown; pessoa_fisica_id: unknown }>(
        'SELECT paciente_id, pessoa_fisica_id FROM beneficiario_plano WHERE id = ?',
        [k.titular.id],
      ),
    );
    expect(Number(ligado?.paciente_id)).toBe(paciente);
    // O beneficiário tem a própria pessoa (nunca a do paciente por arrasto).
    expect(Number(ligado?.pessoa_fisica_id)).not.toBe(pessoa);
    const inexistente = await codigoDe(
      servico.gravarBeneficiario(s, k.titular.id, {
        contrato: k.contrato,
        titular: null,
        vinculo: 1,
        nome: ficha.nome,
        nomeSocial: null,
        cpf: ficha.cpf,
        nascimento: ficha.nascimento,
        sexo: ficha.sexo,
        cns: null,
        nomeMae: ficha.nomeMae,
        inclusao: ficha.inclusao,
        pacienteHospital: 2_000_000_000,
        versao: ficha.versao,
      }),
    );
    expect(inexistente).not.toBe('gravou');
    expect(await versaoPaciente()).toEqual(antes);
  });
});
