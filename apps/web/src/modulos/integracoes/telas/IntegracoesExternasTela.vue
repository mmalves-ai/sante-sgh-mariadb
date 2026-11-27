<script setup lang="ts">
// Central de integrações externas (decisão 53 do dono), em Administração > Integrações. Lista cada integração do
// catálogo com o selo Simulador/Real bem visível, o aviso para passar a definição do fornecedor à equipe de
// desenvolvimento (com o que pedir), os parâmetros, as credenciais (só "definida"; o valor vai ao cofre e nunca volta)
// e a chave do real com justificativa e a senha de novo. Fora de produção o real fica neutralizado: a tela avisa.
// Quem decide é o servidor (config.integracaoExterna.gerir); a tela só esconde os formulários sem a permissão.
import {
  CATALOGO_INTEGRACOES_EXTERNAS,
  type EntradaIntegracaoExterna,
  type IntegracaoExternaLida,
  type ModoIntegracaoExterna,
  type SituacaoIntegracaoExterna,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import SenhaConfirmacao from '../../administracao/componentes/SenhaConfirmacao.vue';
import {
  definirModoIntegracao,
  gravarParametrosIntegracao,
  guardarCredencialIntegracao,
  lerIntegracoesExternas,
} from '../api-integracoes-externas.js';

const { t } = useI18n();
const consulta = useQuery({ queryKey: ['integracoes', 'externas'], queryFn: lerIntegracoesExternas });
const painel = computed(() => consulta.data.value);
const podeGerir = computed(() => pode('config.integracaoExterna.gerir'));
const instante = (d: string) => new Date(d).toLocaleString('pt-BR');

interface Linha {
  readonly entrada: EntradaIntegracaoExterna;
  readonly lida: IntegracaoExternaLida;
}
const linhas = computed<readonly Linha[]>(() => {
  const lidas = new Map((painel.value?.integracoes ?? []).map((i) => [i.id, i]));
  return CATALOGO_INTEGRACOES_EXTERNAS.flatMap((entrada) => {
    const lida = lidas.get(entrada.id);
    return lida ? [{ entrada, lida }] : [];
  });
});

const ehReal = (s: SituacaoIntegracaoExterna) => s === 'real-configurado' || s === 'real-com-falha';
const estadoCredencial = (lida: IntegracaoExternaLida, campo: string): string => {
  const d = lida.credenciais.find((c) => c.campo === campo)?.definida;
  return d === true
    ? t('integracoesExternas.credenciais.definida')
    : d === false
      ? t('integracoesExternas.credenciais.naoDefinida')
      : t('integracoesExternas.credenciais.desconhecida');
};
const rotuloFalta = (e: EntradaIntegracaoExterna, id: string) =>
  e.parametros.find((p) => p.id === id)?.rotulo ?? e.camposCredencial.find((c) => c.id === id)?.rotulo ?? id;

// ── Configurar uma integração por vez ─────────────────────────────────────────────────────────────
const aberta = ref<string | null>(null);
const parametros = reactive<Record<string, string>>({});
const credencial = reactive({ campo: '', valor: '', senha: '' });
const modo = reactive({ modo: 'simulador' as ModoIntegracaoExterna, justificativa: '', senha: '' });
const mensagem = ref<string | null>(null);
const neutralizado = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);

function abrir(l: Linha): void {
  if (aberta.value === l.entrada.id) {
    aberta.value = null;
    return;
  }
  aberta.value = l.entrada.id;
  for (const k of Object.keys(parametros)) Reflect.deleteProperty(parametros, k);
  for (const p of l.entrada.parametros) parametros[p.id] = l.lida.parametros[p.id] ?? '';
  credencial.campo = l.entrada.camposCredencial[0]?.id ?? '';
  credencial.valor = '';
  credencial.senha = '';
  modo.modo = l.lida.modo === 'real' ? 'simulador' : 'real';
  modo.justificativa = '';
  modo.senha = '';
  limpar();
}

function limpar(): void {
  mensagem.value = null;
  neutralizado.value = null;
  recusa.value = null;
  erro.value = null;
}

async function executar(acao: () => Promise<void>): Promise<void> {
  limpar();
  gravando.value = true;
  try {
    await acao();
    await consulta.refetch();
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 401, 403, 409, 422].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    gravando.value = false;
  }
}

const gravarParametros = (l: Linha) =>
  executar(async () => {
    await gravarParametrosIntegracao({
      integracao: l.entrada.id,
      parametros: Object.fromEntries(Object.entries(parametros).map(([k, v]) => [k, v.trim()])),
    });
    mensagem.value = t('integracoesExternas.parametros.gravado', { nome: l.entrada.nome });
  });

const guardarCredencial = (l: Linha) =>
  executar(async () => {
    const campo = credencial.campo;
    try {
      await guardarCredencialIntegracao({
        integracao: l.entrada.id,
        campo,
        valor: credencial.valor,
        senha: credencial.senha,
      });
    } finally {
      // O valor e a senha nunca ficam na tela depois do pedido, aceito ou recusado.
      credencial.valor = '';
      credencial.senha = '';
    }
    mensagem.value = t('integracoesExternas.credenciais.guardada', {
      campo: rotuloFalta(l.entrada, campo),
      nome: l.entrada.nome,
    });
  });

const gravarModo = (l: Linha) =>
  executar(async () => {
    const pedido = modo.modo;
    try {
      const r = await definirModoIntegracao({
        integracao: l.entrada.id,
        modo: pedido,
        justificativa: modo.justificativa,
        senha: modo.senha,
      });
      mensagem.value = t('integracoesExternas.modo.gravado', {
        nome: l.entrada.nome,
        modo: t(`integracoesExternas.modo.${pedido}`),
      });
      if (r.neutralizado)
        neutralizado.value = t('integracoesExternas.modo.neutralizado', { nome: l.entrada.nome });
      modo.justificativa = '';
      modo.modo = r.integracao.modo === 'real' ? 'simulador' : 'real';
    } finally {
      modo.senha = '';
    }
  });

const opcoesCredencial = (e: EntradaIntegracaoExterna) =>
  e.camposCredencial.map((c) => ({ valor: c.id, rotulo: c.rotulo }));
</script>

<template>
  <section
    class="tela-externas"
    aria-labelledby="titulo-integracoes-externas"
    data-testid="tela-integracoes-externas"
  >
    <h1 id="titulo-integracoes-externas">{{ t('integracoesExternas.titulo') }}</h1>
    <p>{{ t('integracoesExternas.texto') }}</p>
    <p v-if="consulta.isLoading.value" role="status">{{ t('integracoesExternas.carregando') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="painel">
      <p class="faixa-ambiente" :data-producao="painel.producao" data-testid="externas-ambiente">
        {{
          painel.producao
            ? t('integracoesExternas.ambiente.producao')
            : t('integracoesExternas.ambiente.foraProducao')
        }}
      </p>
      <SanteAlerta
        v-if="!painel.cofreDisponivel"
        :texto="t('integracoesExternas.ambiente.semCofre')"
        variante="aviso"
        data-testid="externas-sem-cofre"
      />
      <SanteAlerta
        v-if="!podeGerir"
        :texto="t('integracoesExternas.semPermissao')"
        variante="info"
        data-testid="externas-sem-permissao"
      />

      <ul class="lista">
        <li
          v-for="l in linhas"
          :key="l.entrada.id"
          class="cartao"
          :data-testid="`integracao-${l.entrada.id}`"
        >
          <header class="cabecalho">
            <h2 :id="`integracao-${l.entrada.id}-nome`">{{ l.entrada.nome }}</h2>
            <span
              class="selo"
              :data-real="ehReal(l.lida.situacao)"
              :data-situacao="l.lida.situacao"
              :data-testid="`selo-${l.entrada.id}`"
              >{{ t(`integracoesExternas.selos.${l.lida.situacao}`) }}</span
            >
          </header>
          <p>{{ l.entrada.descricao }}</p>
          <p class="discreto">
            {{ t('integracoesExternas.area') }}: {{ t(`integracoesExternas.areas.${l.entrada.area}`) }}
            ·
            {{
              l.lida.alteradoEm
                ? t('integracoesExternas.alterado', {
                    quando: instante(l.lida.alteradoEm),
                    quem: l.lida.alteradoPor ?? '',
                  })
                : t('integracoesExternas.nuncaAlterada')
            }}
          </p>

          <div
            v-if="l.entrada.dependeDefinicaoFornecedor"
            class="fornecedor"
            role="note"
            :data-testid="`fornecedor-${l.entrada.id}`"
          >
            <SanteAlerta :texto="t('integracoesExternas.fornecedor.titulo')" variante="aviso" />
            <p>{{ t('integracoesExternas.fornecedor.texto') }}</p>
            <ul>
              <li v-for="item in l.entrada.oQuePedirAoFornecedor" :key="item">{{ item }}</li>
            </ul>
          </div>

          <template v-if="l.lida.modo === 'real' && l.lida.faltam.length">
            <p>{{ t('integracoesExternas.faltam') }}</p>
            <ul :data-testid="`faltam-${l.entrada.id}`">
              <li v-for="f in l.lida.faltam" :key="f">{{ rotuloFalta(l.entrada, f) }}</li>
            </ul>
          </template>
          <SanteAlerta
            v-if="l.lida.ultimaFalhaEm && l.lida.ultimaFalha"
            :texto="
              t('integracoesExternas.ultimaFalha', {
                quando: instante(l.lida.ultimaFalhaEm),
                motivo: l.lida.ultimaFalha,
              })
            "
            variante="alerta"
          />

          <dl class="estado">
            <template v-for="p in l.entrada.parametros" :key="p.id">
              <dt>{{ p.rotulo }}</dt>
              <dd>{{ l.lida.parametros[p.id] || '—' }}</dd>
            </template>
            <template v-for="c in l.entrada.camposCredencial" :key="c.id">
              <dt>{{ c.rotulo }}</dt>
              <dd :data-testid="`credencial-${l.entrada.id}-${c.id}`">
                {{ estadoCredencial(l.lida, c.id) }}
              </dd>
            </template>
          </dl>

          <SanteBotao
            v-if="podeGerir"
            :rotulo="t('integracoesExternas.configurar')"
            :variante="aberta === l.entrada.id ? 'primario' : 'secundario'"
            :data-testid="`configurar-${l.entrada.id}`"
            @acionar="abrir(l)"
          />

          <div
            v-if="podeGerir && aberta === l.entrada.id"
            class="config"
            :data-testid="`config-${l.entrada.id}`"
          >
            <SanteAlerta
              v-if="recusa"
              :texto="recusa"
              variante="aviso"
              anunciar
              data-testid="externas-recusa"
            />
            <SanteAlerta
              v-if="mensagem"
              :texto="mensagem"
              variante="info"
              anunciar
              data-testid="externas-gravado"
            />
            <SanteAlerta
              v-if="neutralizado"
              :texto="neutralizado"
              variante="aviso"
              anunciar
              data-testid="externas-neutralizado"
            />
            <MensagemErro v-if="erro" :erro="erro" />

            <form
              class="form"
              :aria-labelledby="`parametros-${l.entrada.id}`"
              @submit.prevent="gravarParametros(l)"
            >
              <h3 :id="`parametros-${l.entrada.id}`">{{ t('integracoesExternas.parametros.titulo') }}</h3>
              <p>{{ t('integracoesExternas.parametros.texto') }}</p>
              <p v-if="l.entrada.parametros.length === 0">{{ t('integracoesExternas.parametros.nenhum') }}</p>
              <template v-else>
                <SanteCampoTexto
                  v-for="p in l.entrada.parametros"
                  :id="`param-${l.entrada.id}-${p.id}`"
                  :key="p.id"
                  :model-value="parametros[p.id] ?? ''"
                  @update:model-value="(v: string) => (parametros[p.id] = v)"
                  :rotulo="
                    p.obrigatorio
                      ? t('integracoesExternas.parametros.obrigatorio', { rotulo: p.rotulo })
                      : p.rotulo
                  "
                  :max-bytes="500"
                  :data-testid="`param-${p.id}`"
                />
                <SanteBotao
                  :rotulo="t('integracoesExternas.parametros.gravar')"
                  tipo="submit"
                  variante="secundario"
                  :desabilitado="gravando"
                  data-testid="externas-gravar-parametros"
                />
              </template>
            </form>

            <form
              v-if="l.entrada.camposCredencial.length"
              class="form"
              :aria-labelledby="`credenciais-${l.entrada.id}`"
              @submit.prevent="guardarCredencial(l)"
            >
              <h3 :id="`credenciais-${l.entrada.id}`">{{ t('integracoesExternas.credenciais.titulo') }}</h3>
              <p>{{ t('integracoesExternas.credenciais.texto') }}</p>
              <SanteSelecao
                :id="`credencial-campo-${l.entrada.id}`"
                v-model="credencial.campo"
                :rotulo="t('integracoesExternas.credenciais.campo')"
                :opcoes="opcoesCredencial(l.entrada)"
                data-testid="externas-credencial-campo"
              />
              <div class="campo">
                <label :for="`credencial-valor-${l.entrada.id}`">{{
                  t('integracoesExternas.credenciais.valor')
                }}</label>
                <input
                  :id="`credencial-valor-${l.entrada.id}`"
                  v-model="credencial.valor"
                  type="password"
                  autocomplete="off"
                  required
                  :aria-describedby="`credencial-valor-${l.entrada.id}-ajuda`"
                  data-testid="externas-credencial-valor"
                />
                <small :id="`credencial-valor-${l.entrada.id}-ajuda`">{{
                  t('integracoesExternas.credenciais.valorAjuda')
                }}</small>
              </div>
              <SenhaConfirmacao v-model="credencial.senha" testid="externas-credencial-senha" />
              <SanteBotao
                :rotulo="t('integracoesExternas.credenciais.guardar')"
                tipo="submit"
                variante="secundario"
                :desabilitado="gravando || !painel.cofreDisponivel"
                data-testid="externas-guardar-credencial"
              />
            </form>

            <form class="form" :aria-labelledby="`modo-${l.entrada.id}`" @submit.prevent="gravarModo(l)">
              <h3 :id="`modo-${l.entrada.id}`">{{ t('integracoesExternas.modo.titulo') }}</h3>
              <p>{{ t('integracoesExternas.modo.texto') }}</p>
              <p data-testid="externas-modo-atual">
                {{
                  t('integracoesExternas.modo.atual', { modo: t(`integracoesExternas.modo.${l.lida.modo}`) })
                }}
              </p>
              <fieldset>
                <legend>{{ t('integracoesExternas.modo.escolha') }}</legend>
                <label
                  ><input
                    v-model="modo.modo"
                    type="radio"
                    value="simulador"
                    data-testid="externas-modo-simulador"
                  />
                  {{ t('integracoesExternas.modo.simulador') }}</label
                >
                <label
                  ><input v-model="modo.modo" type="radio" value="real" data-testid="externas-modo-real" />
                  {{ t('integracoesExternas.modo.real') }}</label
                >
              </fieldset>
              <SanteCampoTexto
                v-model="modo.justificativa"
                :rotulo="t('integracoesExternas.modo.justificativa')"
                :max-bytes="500"
                obrigatorio
                data-testid="externas-modo-justificativa"
              />
              <SenhaConfirmacao v-model="modo.senha" testid="externas-modo-senha" />
              <SanteBotao
                :rotulo="t('integracoesExternas.modo.gravar')"
                tipo="submit"
                variante="primario"
                :desabilitado="gravando"
                data-testid="externas-gravar-modo"
              />
            </form>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.discreto {
  color: var(--sgh-texto-secundario);
}
.faixa-ambiente {
  padding: var(--sgh-espaco-2);
  border: 2px solid var(--sgh-aviso);
  background: var(--sgh-fundo-elevado);
  font-weight: 600;
}
.faixa-ambiente[data-producao='true'] {
  border-color: var(--sgh-borda-forte);
}
.lista {
  display: grid;
  gap: var(--sgh-espaco-3, var(--sgh-espaco-2));
  padding: 0;
  list-style: none;
}
.cartao {
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo-elevado);
  padding: var(--sgh-espaco-2);
}
.cabecalho {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
  justify-content: space-between;
}
.cabecalho h2 {
  margin: 0;
}
.selo {
  display: inline-block;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 2px solid var(--sgh-borda-forte);
  border-radius: 999px;
  font-weight: 700;
  font-size: 1.05rem;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.selo[data-real='true'] {
  border-color: var(--sgh-primaria);
  color: var(--sgh-primaria);
}
.selo[data-situacao='real-com-falha'] {
  border-color: var(--sgh-alerta);
  color: var(--sgh-alerta);
}
.fornecedor {
  border-left: 4px solid var(--sgh-aviso);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.estado {
  display: grid;
  grid-template-columns: minmax(10rem, max-content) 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-2);
}
.estado dd {
  margin: 0;
}
.config {
  display: grid;
  gap: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-2);
}
.form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
}
input[type='password'] {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
small {
  color: var(--sgh-texto-secundario);
}
</style>
