// M60, etapa 2 (instalação), na CÓPIA compartilhada, sob a trava da cópia: só leitura. A conferência da instalação lê
// a conexão corrente (MON$ATTACHMENTS) e os scripts registrados (SGH_VERSAO_SCRIPT) sem erro de coluna, e o pacote do
// repositório confere com o banco (nenhum script divergente). Saída só com nomes técnicos e contagens.
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { conferirScripts } from '@sgh/dominio-config';
import {
  executarIsql,
  lerConexaoAtual,
  lerScriptsRegistrados,
  lerScriptsSgh,
  validarPedidoCopia,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Ambiente,
  codigos,
  criarNucleo,
  ctx,
  env,
  PODE_ESCREVER,
  prepararAmbiente,
  raiz,
} from './escrita.spec-util.js';

const CONTA = `SGH_TESTE_SEMPAPEL_${randomBytes(3).toString('hex').toUpperCase()}`;
const SENHA = randomBytes(12).toString('base64url').slice(0, 16);

describe.skipIf(!PODE_ESCREVER)('M60.2: conferência da instalação na cópia', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('a conexão corrente: motor, charset, autenticação, canal e conta lidos do MON$', async () => {
    const c = await a.nucleo.lerSomente(ctx(a), (l) => lerConexaoAtual(l));
    expect(c.versaoMotor).toMatch(/^\d+\.\d+/);
    expect(c.charsetBanco).toBeTruthy();
    expect(c.conta).toBeTruthy();
    expect(c.protocolo).toMatch(/TCP/);
    expect(c.autenticacao).not.toBeNull();
    expect(typeof c.canalCifrado).toBe('boolean');
    console.log(
      `[${a.cod}] conexão: motor ${c.versaoMotor}, banco ${c.charsetBanco}, conexão charset ${c.charsetConexaoId}, ` +
        `autenticação ${c.autenticacao}, cifrado ${c.canalCifrado}, comprimido ${c.canalComprimido}, papel ${c.papel ?? '—'}`,
    );
  });

  it('os scripts do pacote conferem com os registrados (nenhum divergente nem pendente)', async () => {
    const pacote = lerScriptsSgh(resolve(raiz, 'packages/legado/src')).map((s) => ({
      numero: s.numero,
      hash: s.hash,
    }));
    const aplicados = await a.nucleo.lerSomente(ctx(a), (l) => lerScriptsRegistrados(l));
    const r = conferirScripts(pacote, aplicados);
    expect(r.divergentes).toEqual([]);
    expect(r.pendentesTotal).toBe(0);
    console.log(
      `[${a.cod}] scripts: ${r.noPacote} no pacote, ${r.aplicados} no banco, ${r.desconhecidos.length} de outros ramos`,
    );
  });

  it('a conta da aplicação sem o papel: o registro dos scripts sai nulo (recusa do banco), sem exceção', async () => {
    // Conta efêmera sem papel nenhum (como a de uma aplicação parada no meio, achado do ensaio): criada e apagada
    // pelo isql do container da cópia; a senha nunca é impressa. Só leitura.
    const alvo = validarPedidoCopia({ hospital: a.cod, destino: 'dev' }, env);
    const admin = async (sql: string) => {
      const r = executarIsql(alvo.container, alvo.banco, `${sql};\nCOMMIT;\n`);
      if (r.codigo !== 0) throw new Error(`isql: ${r.erro}`);
    };
    await admin(`CREATE USER ${CONTA} PASSWORD '${SENHA}'`);
    try {
      const cod = codigos[0] as string;
      const app = criarNucleo({
        [`FB_${cod.toUpperCase()}_USUARIO`]: CONTA,
        [`FB_${cod.toUpperCase()}_SENHA`]: SENHA,
        FB_POOL_TETO: '1',
      });
      try {
        const conexao = await app.lerSomente(ctx(a), (l) => lerConexaoAtual(l));
        expect(conexao.papel).toBeNull();
        expect(await app.lerSomente(ctx(a), (l) => lerScriptsRegistrados(l))).toBeNull();
        console.log(
          `[${cod}] conta sem papel: conexão lida (papel —), registro dos scripts recusado e tratado`,
        );
      } finally {
        await app.encerrar();
      }
    } finally {
      await admin(`DROP USER ${CONTA}`);
    }
  });
});
