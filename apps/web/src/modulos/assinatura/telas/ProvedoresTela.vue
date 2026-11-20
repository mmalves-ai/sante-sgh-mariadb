<script setup lang="ts">
// Provedores de certificado em nuvem (ficha do M49, seção 7; ICP-06; regra 1; etapa 1):
// `/administracao/assinatura/provedores`. O cadastro de cada provedor (endereço da API v0, identificador do cliente e
// as autoridades certificadoras aceitas) e o segredo, que vai ao cofre e aparece só como "Definido" ou "Não definido";
// a troca do segredo, e a do endereço ou do identificador do cliente com o segredo definido, pedem a senha de novo. Ligar o provedor exige o segredo; a tela avisa quando a mídia não tem pelo
// menos o mínimo de autoridades. Fora de produção, o teste de conexão usa o simulador.
import { MIDIAS_CERTIFICADO, type ProvedoresPscResposta } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroAssinatura from '../componentes/ErroAssinatura.vue';
import { definirSegredo, lerProvedores, salvarProvedor, testarProvedor } from '../api-assinatura.js';

type Provedor = ProvedoresPscResposta['provedores'][number];
/** Etapa 3: as formas de assinatura de cada provedor ficam na tela dos cadastros da assinatura digital. */
const CONSULTA_FORMAS = '/administracao/assinatura/oids';

const { t } = useI18n();
const q = useQuery({ queryKey: ['assinatura', 'provedores'], queryFn: lerProvedores });
const erro = ref<unknown>(null);
const aviso = ref<{ texto: string; variante: 'info' | 'alerta' } | null>(null);
const ocupado = ref(false);

const edicao = ref<{
  versao: number | null;
  codigo: string;
  nome: string;
  uriBase: string;
  clientId: string;
  autoridades: string;
  ativo: boolean;
  justificativa: string;
  /** O endereço e o client_id gravados (trocar qualquer um com o segredo definido pede a senha). */
  original: { uriBase: string; clientId: string; segredoDefinido: boolean } | null;
} | null>(null);
const senhaEdicao = ref('');
const pedeSenha = computed(() => {
  const e = edicao.value;
  return (
    !!e?.original?.segredoDefinido &&
    (e.uriBase.trim() !== e.original.uriBase || e.clientId.trim() !== e.original.clientId)
  );
});
const segredoDe = ref<string | null>(null);
const segredo = ref('');
const justificativaSegredo = ref('');
const senha = ref('');

const midiaRotulo = (m: string) =>
  (MIDIAS_CERTIFICADO as readonly string[]).includes(m) ? t(`assinatura.midias.${m}`) : m;

function novo() {
  edicao.value = {
    versao: null,
    codigo: '',
    nome: '',
    uriBase: 'https://',
    clientId: '',
    autoridades: '',
    ativo: false,
    justificativa: '',
    original: null,
  };
  senhaEdicao.value = '';
}
function editar(p: Provedor) {
  edicao.value = {
    versao: p.versao,
    codigo: p.codigo,
    nome: p.nome,
    uriBase: p.uriBase,
    clientId: p.clientId,
    autoridades: p.autoridades.join('\n'),
    ativo: p.ativo,
    justificativa: '',
    original: { uriBase: p.uriBase, clientId: p.clientId, segredoDefinido: p.segredo === 'definido' },
  };
  senhaEdicao.value = '';
}

async function agir(fn: () => Promise<void>) {
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    await fn();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

const salvar = () =>
  agir(async () => {
    const e = edicao.value!;
    await salvarProvedor({
      versao: e.versao,
      justificativa: e.justificativa,
      provedor: {
        codigo: e.codigo.trim(),
        nome: e.nome.trim(),
        uriBase: e.uriBase.trim(),
        clientId: e.clientId.trim(),
        autoridades: e.autoridades
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
        ativo: e.ativo,
      },
      ...(pedeSenha.value ? { senha: senhaEdicao.value } : {}),
    });
    edicao.value = null;
    senhaEdicao.value = '';
    aviso.value = { texto: t('assinatura.provedores.salvo'), variante: 'info' };
    await q.refetch();
  });

const gravarSegredo = () =>
  agir(async () => {
    await definirSegredo(segredoDe.value!, {
      segredo: segredo.value,
      justificativa: justificativaSegredo.value,
      senha: senha.value,
    });
    segredoDe.value = null;
    segredo.value = '';
    senha.value = '';
    justificativaSegredo.value = '';
    aviso.value = { texto: t('assinatura.provedores.segredoTrocado'), variante: 'info' };
    await q.refetch();
  });

const testar = (codigo: string) =>
  agir(async () => {
    const r = await testarProvedor(codigo);
    aviso.value = r.ok
      ? { texto: t('assinatura.provedores.testeOk'), variante: 'info' }
      : { texto: t('assinatura.provedores.testeFalhou'), variante: 'alerta' };
  });
</script>

<template>
  <section class="tela-assinatura" aria-labelledby="prov-titulo" data-testid="tela-provedores">
    <h1 id="prov-titulo">{{ t('assinatura.provedores.titulo') }}</h1>
    <p>{{ t('assinatura.provedores.subtitulo') }}</p>
    <p class="secundario">{{ t('assinatura.provedores.segredoNoCofre') }}</p>
    <p>
      <RouterLink :to="CONSULTA_FORMAS" data-testid="prov-formas">{{
        t('assinatura.cadastros.formasProvedor')
      }}</RouterLink>
    </p>
    <SanteAlerta
      v-if="aviso"
      :texto="aviso.texto"
      :variante="aviso.variante"
      anunciar
      data-testid="prov-aviso"
    />
    <ErroAssinatura v-if="erro || q.error.value" :erro="erro ?? q.error.value" />
    <template v-if="q.data.value">
      <SanteAlerta
        v-if="q.data.value.modo !== 'producao'"
        :texto="t('assinatura.provedores.testeSimulador')"
        variante="aviso"
      />
      <SanteAlerta
        v-if="q.data.value.cofre === 'indisponivel'"
        :texto="t('assinatura.provedores.cofreIndisponivel')"
        variante="aviso"
      />
      <SanteAlerta
        v-for="a in q.data.value.alertaAutoridades"
        :key="a.midia"
        :texto="
          t('assinatura.provedores.poucasAutoridades', {
            midia: midiaRotulo(a.midia),
            n: a.autoridades,
            minimo: q.data.value.minimoAutoridades,
          })
        "
        variante="aviso"
        data-testid="prov-alerta-autoridades"
      />
      <table v-if="q.data.value.provedores.length" class="tabela" data-testid="prov-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('assinatura.provedores.codigo') }}</th>
            <th scope="col">{{ t('assinatura.provedores.nome') }}</th>
            <th scope="col">{{ t('assinatura.provedores.endereco') }}</th>
            <th scope="col">{{ t('assinatura.provedores.autoridades') }}</th>
            <th scope="col">{{ t('assinatura.provedores.ativo') }}</th>
            <th scope="col">{{ t('assinatura.provedores.segredo') }}</th>
            <th scope="col">{{ t('assinatura.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in q.data.value.provedores" :key="p.codigo" :data-testid="`prov-${p.codigo}`">
            <td>
              {{ p.codigo
              }}<span v-if="p.simulado" class="secundario"> · {{ t('assinatura.provedores.simulado') }}</span>
            </td>
            <td>{{ p.nome }}</td>
            <td>{{ p.uriBase }}</td>
            <td>{{ p.autoridades.join(', ') }}</td>
            <td>{{ p.ativo ? t('assinatura.sim') : t('assinatura.nao') }}</td>
            <td data-testid="prov-segredo">
              {{
                p.segredo === 'definido'
                  ? t('assinatura.provedores.definido')
                  : t('assinatura.provedores.naoDefinido')
              }}
            </td>
            <td>
              <span class="acoes">
                <SanteBotao
                  :rotulo="t('assinatura.provedores.testar')"
                  variante="secundario"
                  :desabilitado="ocupado || !q.data.value.podeEditar"
                  data-testid="prov-testar"
                  @acionar="testar(p.codigo)"
                />
                <template v-if="q.data.value.podeEditar && !p.simulado">
                  <SanteBotao
                    :rotulo="t('assinatura.provedores.editar')"
                    variante="texto"
                    data-testid="prov-editar"
                    @acionar="editar(p)"
                  />
                  <SanteBotao
                    :rotulo="t('assinatura.provedores.trocarSegredo')"
                    variante="texto"
                    data-testid="prov-trocar-segredo"
                    @acionar="segredoDe = p.codigo"
                  />
                </template>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('assinatura.provedores.nenhum') }}</p>
      <span v-if="q.data.value.podeEditar && !edicao" class="acoes">
        <SanteBotao
          :rotulo="t('assinatura.provedores.novo')"
          variante="secundario"
          data-testid="prov-novo"
          @acionar="novo"
        />
      </span>

      <form v-if="edicao" class="bloco" data-testid="prov-form" @submit.prevent="salvar">
        <h2>{{ edicao.versao ? t('assinatura.provedores.editar') : t('assinatura.provedores.novo') }}</h2>
        <span class="campo">
          <label for="prov-codigo">{{ t('assinatura.provedores.codigo') }}</label>
          <input
            id="prov-codigo"
            v-model="edicao.codigo"
            :disabled="edicao.versao !== null"
            maxlength="30"
            required
            data-testid="prov-codigo"
          />
        </span>
        <SanteCampoTexto
          id="prov-nome"
          v-model="edicao.nome"
          :rotulo="t('assinatura.provedores.nome')"
          :max-bytes="60"
          obrigatorio
        />
        <span class="campo">
          <label for="prov-uri">{{ t('assinatura.provedores.endereco') }}</label>
          <input
            id="prov-uri"
            v-model="edicao.uriBase"
            type="url"
            maxlength="200"
            required
            data-testid="prov-uri"
          />
        </span>
        <span class="campo">
          <label for="prov-cliente">{{ t('assinatura.provedores.cliente') }}</label>
          <input
            id="prov-cliente"
            v-model="edicao.clientId"
            maxlength="200"
            required
            data-testid="prov-cliente"
          />
        </span>
        <SanteCampoTexto
          id="prov-autoridades"
          v-model="edicao.autoridades"
          :rotulo="`${t('assinatura.provedores.autoridades')} (${t('assinatura.provedores.autoridadesAjuda')})`"
          :max-bytes="1700"
          multilinha
          obrigatorio
        />
        <span class="campo">
          <label
            ><input v-model="edicao.ativo" type="checkbox" data-testid="prov-ativo" />
            {{ t('assinatura.provedores.ativo') }}</label
          >
          <span class="secundario">{{ t('assinatura.provedores.ativoAjuda') }}</span>
        </span>
        <span v-if="pedeSenha" class="campo" data-testid="prov-pede-senha">
          <label for="prov-senha-edicao">{{ t('assinatura.provedores.senhaAtual') }}</label>
          <span class="secundario">{{ t('assinatura.provedores.senhaDestino') }}</span>
          <input
            id="prov-senha-edicao"
            v-model="senhaEdicao"
            type="password"
            autocomplete="current-password"
            maxlength="200"
            data-testid="prov-senha-edicao"
          />
        </span>
        <SanteCampoTexto
          id="prov-just"
          v-model="edicao.justificativa"
          :rotulo="t('assinatura.justificativa')"
          :max-bytes="400"
          multilinha
          obrigatorio
        />
        <span class="acoes">
          <SanteBotao
            :rotulo="t('assinatura.gravar')"
            tipo="submit"
            :desabilitado="ocupado || edicao.justificativa.trim().length < 10"
            data-testid="prov-gravar"
          />
          <SanteBotao :rotulo="t('assinatura.cancelar')" variante="texto" @acionar="edicao = null" />
        </span>
      </form>

      <form v-if="segredoDe" class="bloco" data-testid="prov-segredo-form" @submit.prevent="gravarSegredo">
        <h2>{{ t('assinatura.provedores.trocarSegredo') }} · {{ segredoDe }}</h2>
        <p class="secundario">{{ t('assinatura.provedores.segredoNoCofre') }}</p>
        <span class="campo">
          <label for="prov-novo-segredo">{{ t('assinatura.provedores.novoSegredo') }}</label>
          <input
            id="prov-novo-segredo"
            v-model="segredo"
            type="password"
            autocomplete="off"
            minlength="8"
            maxlength="4096"
            required
            data-testid="prov-novo-segredo"
          />
        </span>
        <SanteCampoTexto
          id="prov-just-seg"
          v-model="justificativaSegredo"
          :rotulo="t('assinatura.justificativa')"
          :max-bytes="400"
          multilinha
          obrigatorio
        />
        <span class="campo">
          <label for="prov-senha">{{ t('assinatura.provedores.senhaAtual') }}</label>
          <input
            id="prov-senha"
            v-model="senha"
            type="password"
            autocomplete="current-password"
            maxlength="200"
            data-testid="prov-senha"
          />
        </span>
        <span class="acoes">
          <SanteBotao
            :rotulo="t('assinatura.gravar')"
            tipo="submit"
            :desabilitado="ocupado || segredo.length < 8 || justificativaSegredo.trim().length < 10"
            data-testid="prov-gravar-segredo"
          />
          <SanteBotao :rotulo="t('assinatura.cancelar')" variante="texto" @acionar="segredoDe = null" />
        </span>
      </form>
    </template>
  </section>
</template>

<style src="../estilo-assinatura.css"></style>
