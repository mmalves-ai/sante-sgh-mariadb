# ADR 0007: regras da importação, impressão de etiquetas, permissões e acesso do administrador

- **Data:** 2026-11-21
- **Situação:** aceita (decisões do dono no chat da obra, itens 4, 8, 12 e 16 a 23)
- Complementa o ADR 0006 (importação é continuidade). Os itens têm a numeração da lista que o dono respondeu.

## Impressão e permissões

- **4. Etiquetas e pulseiras (opção b).**
  - O servidor envia o ZPL direto à impressora térmica de rede (porta 9100), sem programa nas estações.
  - O QZ Tray fica só como alternativa para impressora USB.
  - O código de barras usa o id próprio do paciente e do atendimento, nunca o do sistema de origem.
- **8. Códigos de permissão próprios (aprovado).**
  - Formato `modulo.recurso.acao`, sem número de menu nem nome do sistema de origem.
  - A correspondência com o menu de origem vive só no mapa do conector (`conector/mapa/permissoes.tsv`), que importa
    os grupos como perfis.
  - Proposta completa: `docs/obra/fatias/f24/saida/padroes.md`.
- **12. Índice de pacientes entre hospitais (MPI): adiado.**
  - Clientes podem ser hospitais de redes diferentes, e **dado de paciente não se compartilha entre clientes**.
  - Qualquer índice comum é tratado depois, com decisão própria.

## Regras da importação (conector)

- **16. Vigência sem data na origem.**
  - A vigência começa na data mais antiga com evidência nos dados: o primeiro uso, ou a criação do registro.
  - Sem nenhuma evidência, começa na data do registro mais antigo da origem ("desde sempre").
  - Nunca se usa a data da carga.
  - Nada pede aprovação depois da importação: a anotação fica só no log técnico.
- **17. Credenciais da origem são copiadas (continuidade).**
  - **Logins são os mesmos.**
  - Senhas de usuário:
    - se a origem guarda resumo (hash) num algoritmo conhecido, o resumo é importado, e no primeiro login certo o
      sistema confere pelo algoritmo antigo e regrava em argon2id, sem o usuário perceber;
    - se a origem guarda a senha legível ou reversível, ela é gravada direto em argon2id;
    - a senha legível nunca é gravada.
  - Senhas de e-mail, tokens de integração e certificados digitais vão para o **cofre de segredos** do cliente,
    cifrados, e nunca para coluna comum do banco.
  - Nunca aparecem em log, relatório ou chat.
- **18. Valor sem significado documentado.**
  - O conector faz **a melhor estimativa possível com os dados disponíveis**: uso, frequência, rótulo, contexto e
    relação com outras tabelas.
  - Só sem nenhuma evidência fica o literal marcado como presumido.
- **19. Código derivado** (duplicado ou longo demais).
  - Permitido, desde que **nenhuma ligação com tabelas filhas se perca**.
  - Toda referência é resolvida pelo id.
  - O código original fica guardado para busca e para o de-para.
  - A conciliação confere as ligações filho → pai.
- **20. Registro que já existe: mesclagem não destrutiva.**
  - Campo vazio no destino é preenchido com o valor da origem.
  - Em conflito, fica o valor do destino, e o da origem vai para o histórico do registro, sem se perder.
  - Nada é sobrescrito nem apagado.
- **21. Histórico da origem:** cada versão antiga vira versão do registro no sistema novo, com o retrato dos campos
  naquele momento.
- **22. Revisão humana pelas telas, não por relatório gigante.**
  - O relatório de conciliação é curto, para o técnico: contagens por entidade, falhas e o que não carregou.
  - Ninguém é obrigado a revisar linha a linha.
  - Os usuários conferem nas telas que usam, onde o dado já está pronto para o trabalho.

## Acesso do administrador da plataforma

- **23. Segundo fator obrigatório.**
  - O padrão é **código enviado por e-mail** ao endereço do administrador (o do dono: o mesmo dos avisos da obra).
  - O administrador pode mudar o método (e-mail ou aplicativo autenticador) e o endereço, com confirmação pelo
    fator atual.
  - Em desenvolvimento, o código do administrador da plataforma sai pelo canal de aviso ao dono (SES, regra 6). Os
    demais e-mails continuam na captura local.
