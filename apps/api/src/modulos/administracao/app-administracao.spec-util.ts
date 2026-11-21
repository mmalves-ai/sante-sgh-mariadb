// App de teste do M10 pelo registro dos módulos (sem o app.module antigo): a base da API (sessão sintética, guarda,
// trilha) e as telas da administração sobre a fonte EM MEMÓRIA. Nada conecta a banco.
import type { DynamicModule } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { criarApp } from '../../app.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { modulo as moduloCadastro } from '../cadastro/modulo.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import type { CarregadorModulo, ContextoModulo } from '../registro.js';
import { AuditoriaController } from './auditoria.controller.js';
import { EstruturaController } from './estrutura.controller.js';
import { FONTE_ADMINISTRACAO, type FonteAdministracao } from './fonte.js';
import { fonteAdministracaoMemoria } from './fonte-memoria.js';
import { PermissoesController } from './permissoes.controller.js';
import { RedeCpfController } from './rede-cpf.controller.js';
import { UsuariosController } from './usuarios.controller.js';

class ModuloAdministracaoTeste {}

function moduloTeste(ctx: ContextoModulo, cadastro: PortaCadastroMemoria, fonte?: FonteAdministracao): DynamicModule {
  return {
    module: ModuloAdministracaoTeste,
    controllers: [UsuariosController, RedeCpfController, PermissoesController, EstruturaController, AuditoriaController],
    providers: [
      {
        provide: FONTE_ADMINISTRACAO,
        useValue:
          fonte ??
          // X-01: o vínculo login → profissional vem da memória do cadastro (a mesma da aba Login do sistema).
          fonteAdministracaoMemoria(ctx.trilha, null, 'dev', () => [], (c, login) =>
            cadastro.profissionalDoLogin(c as never, login),
          ),
      },
    ],
  };
}

/** A app de teste (sem init) com o cadastro (memória) e as telas da administração; `fonte` troca a memória (padrão). */
export async function criarAppAdministracao(
  env: Record<string, string>,
  trilha: RegistradorTrilha,
  fonte?: FonteAdministracao,
): Promise<NestFastifyApplication> {
  const envModulos = { ...env, API_MODULOS: 'cadastro,administracao' };
  const cadastro = new PortaCadastroMemoria();
  const registro: Record<string, CarregadorModulo> = {
    cadastro: async () => ({ modulo: (ctx: ContextoModulo) => moduloCadastro(ctx, { porta: cadastro }) }),
    administracao: async () => ({ modulo: (ctx: ContextoModulo) => moduloTeste(ctx, cadastro, fonte) }),
  };
  return criarApp(lerConfiguracao(envModulos), null, envModulos, { trilha, registro });
}
