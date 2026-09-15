alter table public.transfers drop constraint if exists transfers_sender_id_fkey;
alter table public.transfers drop constraint if exists transfers_receiver_id_fkey;

alter table public.transfers
  add constraint transfers_sender_id_fkey
  foreign key (sender_id) references public.profiles(id) on delete cascade;

alter table public.transfers
  add constraint transfers_receiver_id_fkey
  foreign key (receiver_id) references public.profiles(id) on delete cascade;
