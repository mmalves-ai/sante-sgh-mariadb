<script setup lang="ts">
// Enxoval e kits (M55, fatia F2): `/hotelaria/rouparia/enxoval`. As peças com a categoria, o peso (g) e o custo de
// reposição (o índice de perda em reais); o kit com a composição (só peças, não outros kits); a peça desativada sai
// dos movimentos novos sem apagar o histórico. Gravação pela versão (quem alterou antes faz a tela pedir para atualizar).
import type { CategoriaPecaRoupa, PecaRoupa } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { alterarPecaRoupa, incluirPecaRoupa } from '../api-rouparia.js';
import AvisoRouparia from '../componentes/AvisoRouparia.vue';
import ErroRouparia from '../componentes/ErroRouparia.vue';
import NavRouparia from '../componentes/NavRouparia.vue';
import {
  composicaoDasLinhas,
  fmtReais,
  itensTexto,
  type LinhaPeca,
  numeroDoTexto,
} from '../regras-rouparia.js';
import {
  CHAVE_PAINEL_ROUPARIA,
  OPCOES_CATEGORIA,
  ROTULO_CATEGORIA,
  usarPainelRouparia,
} from '../usar-rouparia.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { painel, d, pode, motivoPode, aviso } = usarPainelRouparia();
const pecas = computed(() => d.value?.pecas ?? []);
const opcoesPecaSimples = computed(() =>
  pecas.value.filter((p) => p.ativa && p.categoria !== 'kit').map((p) => ({ valor: p.id, rotulo: p.nome })),
);

const editando = ref<PecaRoupa | null>(null);
const f = reactive({
  nome: '',
  categoria: 'lencol' as CategoriaPecaRoupa,
  peso: '',
  custo: '',
  ativa: true,
  linhas: [{ peca: null, quantidade: '' }] as LinhaPeca[],
});
function limpar(): void {
  editando.value = null;
  Object.assign(f, { nome: '', categoria: 'lencol', peso: '', custo: '', ativa: true });
  f.linhas = [{ peca: null, quantidade: '' }];
}
function editar(p: PecaRoupa): void {
  editando.value = p;
  Object.assign(f, {
    nome: p.nome,
    categoria: p.categoria,
    peso: String(p.pesoGramas),
    custo:
      p.custoReposicaoCentavos === null
        ? ''
        : (p.custoReposicaoCentavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
    ativa: p.ativa,
  });
  f.linhas = p.composicao.length
    ? p.composicao.map((c) => ({ peca: c.peca, quantidade: String(c.quantidade) }))
    : [{ peca: null, quantidade: '' }];
  document.getElementById('enxoval-form-titulo')?.scrollIntoView({ block: 'start' });
}

const avisos = ref<string[]>([]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function gravar(): Promise<void> {
  avisos.value = [];
  erro.value = null;
  mensagem.value = null;
  const peso = numeroDoTexto(f.peso);
  if (peso === null || !Number.isInteger(peso) || peso < 10 || peso > 20000) {
    avisos.value = [t('rouparia.enxoval.pesoInvalido')];
    return;
  }
  const custo = f.custo.trim() ? numeroDoTexto(f.custo) : null;
  if (f.custo.trim() && (custo === null || custo < 0)) {
    avisos.value = [t('rouparia.enxoval.custoInvalido')];
    return;
  }
  const corpo = {
    nome: f.nome,
    categoria: f.categoria,
    pesoGramas: peso,
    custoReposicaoCentavos: custo === null ? null : Math.round(custo * 100),
    composicao: f.categoria === 'kit' ? composicaoDasLinhas(f.linhas) : [],
    ativa: f.ativa,
    versaoVista: editando.value?.versao ?? null,
  };
  ocupado.value = true;
  try {
    const r = editando.value
      ? await alterarPecaRoupa(editando.value.id, corpo)
      : await incluirPecaRoupa(corpo);
    mensagem.value = r.mensagem;
    limpar();
    await cliente.invalidateQueries({ queryKey: CHAVE_PAINEL_ROUPARIA });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="enxoval-titulo" data-testid="tela-rouparia-enxoval">
    <h1 id="enxoval-titulo">{{ t('rouparia.enxoval.titulo') }}</h1>
    <p>{{ t('rouparia.enxoval.texto') }}</p>
    <NavRouparia />
    <AvisoRouparia :motivo="aviso" />
    <SanteAlerta v-if="mensagem" variante="info" :texto="mensagem" anunciar data-testid="enxoval-mensagem" />
    <ErroRouparia v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!d" role="status">{{ t('rouparia.carregando') }}</p>
    <template v-else>
      <p v-if="pecas.length === 0">{{ t('rouparia.enxoval.nenhuma') }}</p>
      <table v-else class="tabela" data-testid="enxoval-tabela">
        <caption>
          {{
            t('rouparia.enxoval.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('rouparia.enxoval.nome') }}</th>
            <th scope="col">{{ t('rouparia.enxoval.categoria') }}</th>
            <th scope="col">{{ t('rouparia.enxoval.pesoGramas') }}</th>
            <th scope="col">{{ t('rouparia.enxoval.custo') }}</th>
            <th scope="col">{{ t('rouparia.enxoval.composicao') }}</th>
            <th scope="col">{{ t('rouparia.enxoval.situacao') }}</th>
            <th scope="col">{{ t('rouparia.tabela.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pecas" :key="p.id" :data-testid="`peca-${p.id}`">
            <td>{{ p.nome }}</td>
            <td>{{ ROTULO_CATEGORIA[p.categoria] }}</td>
            <td>{{ p.pesoGramas }}</td>
            <td>{{ fmtReais(p.custoReposicaoCentavos) }}</td>
            <td>{{ p.categoria === 'kit' ? itensTexto(p.composicao, pecas) : '—' }}</td>
            <td>{{ p.ativa ? t('rouparia.enxoval.ativa') : t('rouparia.enxoval.inativa') }}</td>
            <td>
              <SanteBotao
                v-if="pode"
                variante="texto"
                :rotulo="t('rouparia.enxoval.alterar')"
                :data-testid="`peca-alterar-${p.id}`"
                @click="editar(p)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <section class="painel" aria-labelledby="enxoval-form-titulo">
        <h2 id="enxoval-form-titulo">
          {{ editando ? t('rouparia.enxoval.editar', { nome: editando.nome }) : t('rouparia.enxoval.nova') }}
        </h2>
        <p v-if="!pode" class="secundario">{{ motivoPode }}</p>
        <form v-else class="formulario" data-testid="enxoval-form" @submit.prevent="gravar">
          <div class="grade">
            <SanteCampoTexto
              v-model="f.nome"
              :rotulo="t('rouparia.enxoval.nome')"
              :max-bytes="60"
              obrigatorio
            />
            <SanteSelecao
              v-model="f.categoria"
              :rotulo="t('rouparia.enxoval.categoria')"
              :opcoes="OPCOES_CATEGORIA"
              obrigatorio
              data-testid="enxoval-categoria"
            />
            <div class="campo">
              <label for="enxoval-peso">{{ t('rouparia.enxoval.pesoGramas') }}</label>
              <input
                id="enxoval-peso"
                v-model="f.peso"
                type="number"
                min="10"
                max="20000"
                required
                data-testid="enxoval-peso"
              />
            </div>
            <div class="campo">
              <label for="enxoval-custo">{{ t('rouparia.enxoval.custo') }}</label>
              <input
                id="enxoval-custo"
                v-model="f.custo"
                type="text"
                inputmode="decimal"
                autocomplete="off"
              />
            </div>
            <div class="campo">
              <label for="enxoval-ativa">
                <input id="enxoval-ativa" v-model="f.ativa" type="checkbox" />
                {{ t('rouparia.enxoval.ativa') }}
              </label>
            </div>
          </div>
          <fieldset v-if="f.categoria === 'kit'" class="itens" data-testid="enxoval-composicao">
            <legend>{{ t('rouparia.enxoval.composicao') }}</legend>
            <div v-for="(l, i) in f.linhas" :key="i" class="grade">
              <SanteSelecao
                v-model="l.peca"
                :rotulo="`${t('rouparia.campos.peca')} ${i + 1}`"
                :opcoes="opcoesPecaSimples"
                busca
              />
              <div class="campo">
                <label :for="`enxoval-qtd-${i}`">{{ t('rouparia.campos.quantidade') }} {{ i + 1 }}</label>
                <input :id="`enxoval-qtd-${i}`" v-model="l.quantidade" type="number" min="1" max="99" />
              </div>
              <SanteBotao
                variante="texto"
                :rotulo="t('rouparia.form.removerPeca', { n: i + 1 })"
                @click="f.linhas.splice(i, 1)"
              />
            </div>
            <SanteBotao
              variante="secundario"
              :rotulo="t('rouparia.form.adicionarPeca')"
              @click="f.linhas.push({ peca: null, quantidade: '' })"
            />
          </fieldset>
          <ErroRouparia :erro="erro" :mensagens="avisos" />
          <div class="acoes">
            <SanteBotao
              tipo="submit"
              :rotulo="t('rouparia.enxoval.gravar')"
              :desabilitado="ocupado"
              data-testid="enxoval-gravar"
            />
            <SanteBotao
              v-if="editando"
              variante="secundario"
              :rotulo="t('rouparia.enxoval.cancelarEdicao')"
              @click="limpar"
            />
          </div>
        </form>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="./estilo-rouparia.css"></style>
