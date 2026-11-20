// M59-F2 na cópia (ficha do M59, seção 10: "login com credencial forte; login sem 2FA recusado para perfil crítico"):
// o serviço da identidade da API sobre a porta do núcleo, numa transação DESFEITA da cópia (ROLLBACK). Um usuário
// SINTÉTICO com senha antiga sintética entra pelo caminho antigo, a credencial forte é regravada (Argon2id) e passa a
// decidir sozinha; a política do segundo fator para o perfil crítico (prazo de adesão zero) recusa o login sem segundo
// fator, outro perfil segue opcional; cadastrado o segundo fator, o login pede o código, recusa o errado e o mesmo passo
// não vale duas vezes. Só contagens e classes na saída; nada fica na cópia.
import { randomBytes } from 'node:crypto';
import { codigoTotp } from '@sgh/dominio-acesso';
import type { Escritor, NucleoLegado } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { portaIdentidadeDoNucleo } from '../identidade/porta-identidade-legado.js';
import { type AtorIdentidade, ServicoIdentidade } from '../identidade/servico-identidade.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from './copia.spec-util.js';

const LOGIN = 'SINT.SGH.M59.REHASH';
const SENHA = 'senha-sintetica-M59';
const HASH_ANTIGO = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'; // 40 hex sintéticos (nunca de pessoa real)
const SAL = 'SALTSINTETICO0123456';
/** Argon2id leve no teste (o padrão da produção é o do ADR 0021). */
const ARGON2_TESTE = { memoria: 8192, passes: 1, paralelismo: 1 };

describe.skipIf(!PODE_ESCREVER)('M59-F2 na cópia: rehash no primeiro login e o segundo fator', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('credencial forte no primeiro login; sem segundo fator, o perfil crítico não entra; com ele, o código decide', async () => {
    const r = await a.nucleo.desfazendoNaCopia(
      { ...a.c, traceId: 'int-m59-f2-rehash' },
      async (w: Escritor) => {
        // A porta do núcleo sobre a MESMA transação desfeita (lê o que ela gravou; nada confirma).
        const naTransacao = {
          rede: a.nucleo.rede,
          lerSomente: (_c: unknown, fn: (l: Escritor) => Promise<unknown>) => fn(w),
          gravarSgh: (_c: unknown, fn: (e: Escritor) => Promise<unknown>) => fn(w),
        } as unknown as Pick<NucleoLegado, 'rede' | 'lerSomente' | 'gravarSgh'>;
        let agora = Date.now();
        const s = new ServicoIdentidade({
          porta: portaIdentidadeDoNucleo(naTransacao),
          contingencia: async () => true,
          chave: randomBytes(32),
          emissor: 'Sante SGH (teste)',
          argon2: ARGON2_TESTE,
          agora: () => agora,
        });

        const [m] = await w.consultar('SELECT MAX(ID_TBUSERS) M FROM TBUSERS');
        const id = Number(m?.['M']) + 1;
        if (id > 32767) throw new Error('Sem faixa de ID livre (SMALLINT).');
        await w.executar(
          'INSERT INTO TBUSERS (ID_TBUSERS, NOME, NOMEC, SENHA, SALT, SENHA_CRIPTOGRAFADA, STATUS, BLOQUEADO) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, LOGIN, 'USUARIO SINTETICO SGH M59 REHASH', HASH_ANTIGO, SAL, 'T', 'T', 'F'],
        );
        // D-DIA-F2-59: a troca de senha no mesmo dia da credencial forte conta como posterior; a senha antiga do
        // usuário sintético é de 30 dias antes, para o login depois da regravação decidir pela forte.
        await w.executar(
          'UPDATE TBUSERS SET DATA_ULTIMA_ALTERACAO_SENHA = DATEADD(-30 DAY TO CURRENT_DATE) WHERE ID_TBUSERS = ?',
          [id],
        );
        const ator: AtorIdentidade = {
          rede: a.nucleo.rede,
          hospital: a.cod,
          login: LOGIN,
          idUsuario: id,
          estacao: null,
          correlacao: 'int-m59-f2-rehash',
        };

        // 1. Primeiro login: sem credencial forte, o caminho é o antigo; conferida a senha antiga, regrava.
        const antes = (await s.autenticar(a.cod, LOGIN, SENHA)).tipo;
        const regravou = await s.regravar(ator, SENHA);
        const [cred] = await w.consultar(
          `SELECT COUNT(*) N, MAX(ALGORITMO) ALG FROM SGH_ACESSO_CREDENCIAL
            WHERE LOGIN = ? AND ID_TBUSERS = ? AND SUBSTITUIDA_EM IS NULL`,
          [LOGIN, id],
        );
        // 2. Depois: só a forte decide (a certa entra, a errada não; a senha antiga continua guardada).
        const certa = (await s.autenticar(a.cod, LOGIN, SENHA)).tipo;
        const errada = (await s.autenticar(a.cod, LOGIN, 'outra-senha-sintetica')).tipo;

        // 3. A política: perfil crítico com prazo de adesão zero a partir de hoje.
        const critico = { perfil: 'gestor-acessos', complementares: [], grupo: null };
        const comum = { perfil: 'recepcionista', complementares: [], grupo: null };
        await s.incluirPolitica(ator, {
          alvo: 'perfil',
          valor: 'gestor-acessos',
          onda: 1,
          inicio: s.hoje(),
          prazoAdesaoDias: 0,
          motivo: 'teste de integração M59-F2',
        });
        const conta = { login: LOGIN, id };
        const semFatorCritico = (await s.segundoFatorNoLogin(a.cod, conta, critico, undefined)).tipo;
        const semFatorComum = await s.segundoFatorNoLogin(a.cod, conta, comum, undefined);

        // 4. Cadastro do segundo fator: o primeiro código certo ativa; o login passa a pedir o código.
        const inicio = await s.iniciarCadastro(ator);
        await s.confirmarCadastro(ator, codigoTotp(inicio.segredo, agora));
        agora += 30_000; // o próximo passo (o do cadastro não vale de novo)
        const semCodigo = (await s.segundoFatorNoLogin(a.cod, conta, critico, undefined)).tipo;
        const codigoErrado = (await s.segundoFatorNoLogin(a.cod, conta, critico, '000000')).tipo;
        const codigo = codigoTotp(inicio.segredo, agora);
        const comCodigo = await s.segundoFatorNoLogin(a.cod, conta, critico, codigo);
        const repetido = (await s.segundoFatorNoLogin(a.cod, conta, critico, codigo)).tipo;
        const [antiga] = await w.consultar(
          `SELECT CASE WHEN SENHA IS NULL THEN 'F' ELSE 'T' END TEM FROM TBUSERS WHERE NOME = ?`,
          [LOGIN],
        );
        return {
          antes,
          regravou,
          credenciais: Number(cred?.['N']),
          algoritmo: String(cred?.['ALG'] ?? '').trim(),
          certa,
          errada,
          semFatorCritico,
          semFatorComum: semFatorComum.tipo === 'entrar' ? semFatorComum.info.exigencia : semFatorComum.tipo,
          semCodigo,
          codigoErrado,
          comCodigo: comCodigo.tipo === 'entrar' ? comCodigo.info : comCodigo.tipo,
          repetido,
          senhaAntigaGuardada: String(antiga?.['TEM'] ?? '').trim(),
        };
      },
    );
    console.log(`[${a.cod}] M59-F2 rehash/2FA ${JSON.stringify(r)}`);
    expect(r.antes).toBe('legado');
    expect(r.regravou).toBe(true);
    expect(r.credenciais).toBe(1);
    expect(r.algoritmo).toBe('argon2id');
    expect(r.certa).toBe('forte-ok');
    expect(r.errada).toBe('forte-invalida');
    expect(r.semFatorCritico).toBe('cadastro-obrigatorio');
    expect(r.semFatorComum).toBe('opcional');
    expect(r.semCodigo).toBe('codigo-necessario');
    expect(r.codigoErrado).toBe('codigo-invalido');
    expect(r.comCodigo).toEqual({
      cadastrado: true,
      disponivel: true,
      exigencia: 'obrigatorio',
      prazoAdesaoAte: null,
    });
    expect(r.repetido).toBe('codigo-invalido');
    expect(r.senhaAntigaGuardada).toBe('T');
    // Depois do ROLLBACK, nada do usuário sintético fica.
    const [n] = await a.nucleo.consultar(
      { ...a.c, traceId: 'int-m59-f2-rehash' },
      'SELECT COUNT(*) N FROM TBUSERS WHERE NOME = ?',
      [LOGIN],
    );
    expect(Number(n?.['N'])).toBe(0);
  });
});
